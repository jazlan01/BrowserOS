diff --git a/chrome/browser/devtools/chrome_devtools_manager_delegate.cc b/chrome/browser/devtools/chrome_devtools_manager_delegate.cc
index 4173438cc19fb..b590826be0c7d 100644
--- a/chrome/browser/devtools/chrome_devtools_manager_delegate.cc
+++ b/chrome/browser/devtools/chrome_devtools_manager_delegate.cc
@@ -46,6 +46,11 @@
 #include "components/guest_view/browser/guest_view_base.h"
 #include "components/keep_alive_registry/keep_alive_types.h"
 #include "components/keep_alive_registry/scoped_keep_alive.h"
+#include "base/json/json_reader.h"
+#include "base/json/json_writer.h"
+#include "base/strings/stringprintf.h"
+#include "chrome/browser/devtools/protocol/browser_handler.h"
+#include "components/sessions/content/session_tab_helper.h"
 #include "components/tabs/public/tab_interface.h"
 #include "content/public/browser/browser_thread.h"
 #include "content/public/browser/devtools_agent_host.h"
@@ -342,6 +347,121 @@ std::optional<bool> ChromeDevToolsManagerDelegate::ShouldReportAsTabTarget(
   return std::nullopt;
 }
 
+bool ChromeDevToolsManagerDelegate::GetTargetTabId(
+    content::WebContents* web_contents,
+    int* tab_id,
+    int* window_id) {
+  SessionID sid = sessions::SessionTabHelper::IdForTab(web_contents);
+  if (!sid.is_valid())
+    return false;
+  *tab_id = sid.id();
+  SessionID wid =
+      sessions::SessionTabHelper::IdForWindowContainingTab(web_contents);
+  *window_id = wid.is_valid() ? wid.id() : -1;
+  return true;
+}
+
+// ─── Agent origin scope enforcement ─────────────────────────────────────────
+
+namespace {
+
+// Writes a CDP error response directly to the client's DispatchProtocolMessage.
+void SendAgentScopeError(content::DevToolsAgentHostClient* client,
+                         int id,
+                         const std::string& code,
+                         const std::string& message) {
+  base::Value::Dict error_obj;
+  error_obj.Set("code", -32000);
+  error_obj.Set("message", message);
+  error_obj.Set("data", code);
+  base::Value::Dict response;
+  response.Set("id", id);
+  response.Set("error", std::move(error_obj));
+  std::string json;
+  base::JSONWriter::Write(base::Value(std::move(response)), &json);
+  client->DispatchProtocolMessage(nullptr, base::as_byte_span(json));
+}
+
+}  // namespace
+
+bool ChromeDevToolsManagerDelegate::HandleCommand(
+    content::DevToolsAgentHost* agent_host,
+    content::DevToolsAgentHostClient* client,
+    base::span<const uint8_t> message) {
+  // Fast path: parse the CDP message and check method name.
+  std::string_view message_str(
+      reinterpret_cast<const char*>(message.data()), message.size());
+  auto dict = base::JSONReader::ReadDict(message_str);
+  if (!dict) return false;
+
+  const std::string* method = dict->FindString("method");
+  if (!method || *method != "Target.attachToTarget") return false;
+
+  const base::Value::Dict* params = dict->FindDict("params");
+  if (!params) return false;
+
+  const std::string* scope_token = params->FindString("agentOriginScopeToken");
+  if (!scope_token) return false;  // No scope token — let normal dispatch handle it.
+
+  const int msg_id = dict->FindInt("id").value_or(0);
+
+  // Validate the scope token.
+  std::optional<std::string> allowed_origin =
+      BrowserHandler::LookupScopeOrigin(*scope_token);
+  if (!allowed_origin) {
+    SendAgentScopeError(client, msg_id, "AgentOriginScope.UnknownToken",
+                        "Unknown agentOriginScopeToken: '" + *scope_token + "'");
+    return true;
+  }
+
+  // Resolve the target.
+  const std::string* target_id = params->FindString("targetId");
+  if (!target_id) {
+    SendAgentScopeError(client, msg_id, "AgentOriginScope.MissingTarget",
+                        "targetId is required when agentOriginScopeToken is set");
+    return true;
+  }
+
+  scoped_refptr<content::DevToolsAgentHost> target_host =
+      content::DevToolsAgentHost::GetForId(*target_id);
+  if (!target_host) {
+    SendAgentScopeError(client, msg_id, "AgentOriginScope.TargetNotFound",
+                        "Target not found: " + *target_id);
+    return true;
+  }
+
+  content::WebContents* wc = target_host->GetWebContents();
+  if (!wc) {
+    // Non-page targets (workers, extensions, etc.) are not allowed under a scope.
+    SendAgentScopeError(
+        client, msg_id, "AgentOriginScope.Violation",
+        "Target '" + *target_id +
+            "' has no page context. Origin-scoped agents may only attach to "
+            "page targets.");
+    return true;
+  }
+
+  // Get the target's actual committed origin.
+  url::Origin target_origin =
+      wc->GetPrimaryPage().GetMainDocument().GetLastCommittedOrigin();
+  std::string target_origin_str = target_origin.Serialize();
+
+  if (target_origin_str != *allowed_origin) {
+    SendAgentScopeError(
+        client, msg_id, "AgentOriginScope.Violation",
+        base::StringPrintf(
+            "Origin policy violation: target '%s' has origin '%s' but this "
+            "agent scope only permits '%s'. Cross-origin attachment blocked.",
+            target_id->c_str(), target_origin_str.c_str(),
+            allowed_origin->c_str()));
+    return true;
+  }
+
+  // Origin matches — strip our custom param and let normal dispatch proceed.
+  // We return false so the command continues through the standard pipeline.
+  return false;
+}
+
 std::string ChromeDevToolsManagerDelegate::GetTargetTitle(
     content::WebContents* web_contents) {
   if (auto iwa_name_version = GetIsolatedWebAppNameAndVersion(web_contents)) {

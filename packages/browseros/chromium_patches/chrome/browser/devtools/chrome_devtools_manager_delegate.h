diff --git a/chrome/browser/devtools/chrome_devtools_manager_delegate.h b/chrome/browser/devtools/chrome_devtools_manager_delegate.h
index a37b46861fb3d..af1e0e2602c88 100644
--- a/chrome/browser/devtools/chrome_devtools_manager_delegate.h
+++ b/chrome/browser/devtools/chrome_devtools_manager_delegate.h
@@ -73,6 +73,17 @@ class ChromeDevToolsManagerDelegate : public content::DevToolsManagerDelegate,
   std::string GetTargetTitle(content::WebContents* web_contents) override;
   std::optional<bool> ShouldReportAsTabTarget(
       content::WebContents* web_contents) override;
+  bool GetTargetTabId(content::WebContents* web_contents,
+                      int* tab_id,
+                      int* window_id) override;
+
+  // Intercepts CDP commands before dispatch. Used to enforce agent origin
+  // scopes: if Target.attachToTarget carries an agentOriginScopeToken, the
+  // target's committed origin is validated against the registered scope, and
+  // the command is rejected (with a CDP error) if origins do not match.
+  bool HandleCommand(content::DevToolsAgentHost* agent_host,
+                     content::DevToolsAgentHostClient* client,
+                     base::span<const uint8_t> message) override;

   content::BrowserContext* CreateBrowserContext() override;
   void DisposeBrowserContext(content::BrowserContext*,

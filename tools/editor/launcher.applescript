-- "Website Editor.app": starts the editor's server (if it isn't running) and opens it in the browser.
-- Rebuild the app after moving the repo:
--   osacompile -o "$HOME/Desktop/Code/Website Editor.app" tools/editor/launcher.applescript
set repo to POSIX path of ((path to home folder as text) & "Desktop:Code:Website:")
try
	do shell script "cd " & quoted form of repo & " && (curl -s -m 1 localhost:8765/api/status >/dev/null || (/opt/homebrew/bin/python3 tools/editor/server.py > /tmp/website-editor.log 2>&1 &)); for i in $(seq 30); do curl -s -m 1 localhost:8765/api/status >/dev/null && exit 0; sleep 0.2; done; exit 1"
	open location "http://localhost:8765/_editor/"
on error
	-- Almost always macOS privacy: the app needs permission to read the Desktop folder, once.
	set reply to button returned of (display dialog "Website Editor couldn't start. macOS has to allow it to open files in your Desktop folder (the website lives there)." & return & return & "Open System Settings › Privacy & Security › Files and Folders, turn on Desktop Folder for Website Editor, then open it again." buttons {"Cancel", "Open Settings"} default button "Open Settings" with icon caution)
	if reply is "Open Settings" then open location "x-apple.systempreferences:com.apple.preference.security?Privacy_FilesAndFolders"
end try

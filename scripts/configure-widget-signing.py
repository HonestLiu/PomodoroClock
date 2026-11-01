"""Generate matching host/extension metadata; never store a developer identity in source."""
import os
import json
import pathlib
import plistlib

root = pathlib.Path(__file__).resolve().parent.parent
output = root / "macos/build"
output.mkdir(parents=True, exist_ok=True)
team = os.environ.get("APPLE_TEAM_ID", "")
group = os.environ.get("FOCUS_WIDGET_APP_GROUP") or (
    f"{team}.com.focuspomodoro.shared" if team else "group.com.focuspomodoro.desktop"
)

def write(source, destination, update):
    with open(root / source, "rb") as stream:
        data = plistlib.load(stream)
    data.update(update)
    with open(output / destination, "wb") as stream:
        plistlib.dump(data, stream)

groups = {"com.apple.security.application-groups": [group]}
# The team is supplied by the certificate's CodeDirectory. Explicitly claiming
# this restricted entitlement requires a matching provisioning profile and can
# make a directly distributed app fail at spawn even when codesign verifies it.
write("src-tauri/Entitlements.plist", "Host.entitlements", groups)
write("macos/Widgets/Widgets.entitlements", "Widget.entitlements", groups)
write("src-tauri/Info.plist", "HostInfo.plist", {"FocusWidgetAppGroup": group})
write("macos/Widgets/Info.plist", "WidgetInfo.plist", {"FocusWidgetAppGroup": group})
with open(output / "signing.config.json", "w") as stream:
    json.dump({"bundle": {"macOS": {
        "signingIdentity": os.environ.get("APPLE_SIGNING_IDENTITY", "-"),
        "entitlements": str(output / "Host.entitlements"),
        "infoPlist": str(output / "HostInfo.plist"),
    }}}, stream)
print(f"Widget App Group: {group}")

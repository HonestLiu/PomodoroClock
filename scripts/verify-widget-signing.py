"""Fail before installation when host/extension signatures cannot share widget data."""
import pathlib
import plistlib
import subprocess
import sys

app = pathlib.Path(sys.argv[1])
extension = app / "Contents/PlugIns/FocusWidgets.appex"
subprocess.run(["codesign", "--verify", "--deep", "--strict", str(app)], check=True)
teams = []
groups = []
for bundle in [app, extension]:
    with (bundle / "Contents/Info.plist").open("rb") as stream:
        info = plistlib.load(stream)
    detail = subprocess.run(["codesign", "-dvv", str(bundle)], capture_output=True, text=True, check=True)
    team = next((line.split("=", 1)[1] for line in detail.stderr.splitlines() if line.startswith("TeamIdentifier=")), "")
    if not team or team == "not set":
        sys.exit(f"Widget data sharing requires a real signing team: {bundle}")
    result = subprocess.run(["codesign", "-d", "--entitlements", ":-", str(bundle)], capture_output=True, check=True)
    entitlements = plistlib.loads(result.stdout)
    if "com.apple.developer.team-identifier" in entitlements and not (bundle / "Contents/embedded.provisionprofile").exists():
        sys.exit(f"Restricted team-identifier entitlement requires a provisioning profile; use the certificate team instead: {bundle}")
    group = info.get("FocusWidgetAppGroup")
    if not group or group not in entitlements.get("com.apple.security.application-groups", []):
        sys.exit(f"Info.plist and App Group entitlement do not match: {bundle}")
    if not group.startswith("group.") and not group.startswith(team + "."):
        sys.exit(f"App Group prefix does not match signing team: {bundle}")
    teams.append(team)
    groups.append(group)
if teams[0] != teams[1] or groups[0] != groups[1]:
    sys.exit("Host and widget must have identical signing teams and shared groups")
print(f"Widget signing verified: team={teams[0]}, group={groups[0]}")
print("This verifies permissions configuration; confirm snapshot write/read and the displayed widget separately.")

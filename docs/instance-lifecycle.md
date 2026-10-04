# Independent instances and running sessions

Each library instance owns its game folder, installed mods and backups, launch options, and a `Tempest_<instance ID>` game user-data folder. Mod updates target only the selected instance. Tempest no longer updates Core mods throughout the library at startup.

When existing instance records resolve to the same game folder, the launcher keeps the first registration on the original folder and makes full file copies for the other registrations. Imported Steam/Epic folders remain on disk. Copies become Tempest-managed installations. Close games and finish downloads before this migration; failures are displayed with a retry action, and file mutations cannot use a stale shared path.

Choose **Copy instance** from the instance menu to make another installation with the same game version, mods, mod backups, launch options, color, settings, and launcher token/assembly cache. Choose a new folder with enough space for the entire game. Copying does not download newer mods or run setup again. Files are copied into temporary directories and committed together; existing destinations and links/junctions are rejected.

After Play, the smaller **Open additional instance** button starts another session of that library instance. The running-session menu closes individual sessions. The main **Stop all** button closes all sessions belonging to that instance. Sessions retain stable numbers as others close. Natural exits remove only the matching session; stopping one instance does not stop other library instances. Close all sessions before changing mods, copying, verifying, or removing an instance.

Additional sessions of the same library instance use its existing mods and settings. Use **Copy instance** for an independently configurable installation.

## Verification

Run `dotnet build Tempest.slnx`, `pnpm check` and launcher lint. These fixture checks never use an installed game:

```powershell
node scripts/verify-instance-storage.mjs
node scripts/verify-instance-sessions.mjs
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/verify-instance-copies.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/verify-launch-session-processes.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/verify-uninstall-cleanup.ps1
```

The copy and native session scripts also accept `-Cli <packaged tempest-cli.exe>`. They check real mod operations and separate Windows process trees using disposable fixtures. Actual concurrent Paladins gameplay and Wine/Proton behavior still require manual testing.

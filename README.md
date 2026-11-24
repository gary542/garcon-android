# Garçon for Android — café Wi-Fi edition

Install the same APK on every Android phone. One phone holds the café database and shares confirmed orders with the others over the local Wi-Fi. The host can also be a working station. This standalone edition starts with its own empty café. No hosting subscription, cloud account, or original Garçon deployment is required.

## First service

1. Connect the phones to the same private café Wi-Fi. Choose **Host café on this phone** on one reliable phone, preferably the one that stays at the till. Enter the café name, owner email and a new owner password of at least 12 characters. These credentials belong to this installation.
2. As owner, open **Menus** to add a menu and products with prices. In **Settings → Tables**, add your table numbers. Under **Settings → Team login**, set a separate team password of at least 10 characters. Numbered waiter, kitchen and cashier roles start with three slots each.
3. On the host, tap **Connection → Share invite** or **Copy invite**. On each other phone, open **Join from a team phone**, paste the complete invite and tap **Join café**. Use the owner's business email with the **team password**, then choose a role and number. Keep the owner password for administration.
4. To use the host as the cashier, use **Lock / switch**, choose **Team**, sign in with the team login, and select **Cashier 1**. The host continues sharing the café while you change roles.
5. On the waiter phone, open a table, add items and instructions, and tap **Send to kitchen**. The cook chooses **Start preparing** and then **Send to Till**. After payment at the café's usual till, the cashier chooses **Mark as paid** and confirms. Garçon removes the order amounts and releases the table.

## During service

Keep the host connected to power and the same Wi-Fi. An ongoing Android service and a wake lock keep the host available during a shift; allow the host notification when asked. The **Connection** screen lets you reopen or stop hosting. Use **Stop hosting** after service to release the wake lock. Android force-stop, device shutdown, network loss or device-specific battery restrictions can interrupt hosting.

Each staff screen checks the host about every 2.5 seconds while visible. The host confirms accepted changes and rejects duplicate submissions using the original submission reference. Unsent drafts remain on the originating phone. After a disconnect, restore the host and Wi-Fi, then use **Retry submission** if offered. If the host address changes, share a fresh invite from that same host. Networks that isolate guest devices will prevent them from connecting.

The host stores the café in private Android SQLite storage. Clearing its data or uninstalling it can erase the café. This edition has no cloud sync, transfer or backup/restore feature. Normal upgrades need the same package and signing key. Owner and staff credentials from a separate web deployment are independent. Garçon records order handling; the café's existing till handles payment.

## Build from source

Open this directory in Android Studio with JDK 17, SDK Platform 35 and Build Tools 34.0.0. Run `./gradlew assembleDebug` (Windows: `gradlew.bat assembleDebug`). The resulting universal test APK is `app/build/outputs/apk/debug/app-debug.apk`. Minimum Android version is 8.0 (API 26). The interface uses Android System WebView 66 or newer.

The pilot installer uses the Android development signer. Its package ID is `uk.co.agentengines.garcon` and its signer certificate SHA-256 is `452fb4ce2112d71afb6a2450a065dc348be56765cd03d6c846c13f9b217a91fc`. The source ZIP excludes signing credentials. A source build on a different machine normally uses a different development signer. Use an owner-controlled release key before deploying a long-lived café.

- Kotlin and Compose implement the host/join screen and connection controls. Android WebView renders the bundled Garçon service interface, logo, images and fonts from an internal origin. Android's system picker handles optional product photos.
- A foreground service owns the local SQLite database and serialized order operations. QuickJS runs the adapted Garçon service rules. Android supplies the database, secure randomness, password hashing (PBKDF2-HMAC-SHA256), London business dates and TLS identity. Clients use TCP port 46473 over TLS and check the host certificate fingerprint from the invite. Only the host's local UI may create the café.
- `android-sources/` contains the editable JavaScript. The compiled assets are included, so a normal Gradle build needs no Node installation. For UI or service-rule changes, rebuild those assets with the included script and esbuild 0.24.2, then rebuild the APK.
- `./gradlew connectedDebugAndroidTest` runs the café handoff test on a disposable Android emulator or device. It uses a separate temporary database and independently authenticated encrypted sessions. It checks the waiter, kitchen and cashier flow, retry deduplication, role restrictions, host identity, settlement and persistence after reopening the database.

The two-device pilot test used two Android 9 emulators and three separate signed-in roles. A waiter sent two £3.20 flat whites with an “Oat milk” note for table 12. The kitchen on the other Android device received the note and sent the ticket to the till. The cashier confirmed £6.40, marked the table paid and the waiter saw the open bill disappear. The test fixture used an emulator network forward between two isolated virtual networks.

This Android edition is a standalone build of Garçon. The existing AgentEngines artwork and included font licenses are retained.

The native engine in this pilot is built for standard 4 KB memory pages. Check 16 KB page-size compatibility before distributing to newer devices that require it. Test the real café's Wi-Fi, device battery settings and recovery from an interrupted shift before relying on it during service.

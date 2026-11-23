# Architecture

How the app is built, and why. For setup and usage, see the [README](../README.md).

## Processes

- **Window** (`src/renderer`): React. It only draws and asks. It runs with `sandbox` and `contextIsolation`, without
  Node, and reaches the system only through `window.api`.
- **Preload** (`src/preload`): exposes that small, typed `window.api` and nothing else.
- **Main process** (`src/main`): validates every request, talks to Windows (PowerShell, `netsh`, the registry) and
  owns anything that changes a setting, always behind a confirmation.

Unlike disk-sleuth there is no separate worker process: nothing here takes long enough to block the window. Slow
Windows calls run as child processes (PowerShell), which are asynchronous already.

## Typed IPC

`src/shared/ipc.ts` lists every request (`InvokeMap`), fire-and-forget message (`SendMap`) and event (`EventMap`), and
the `Api` the window sees. If one side changes, the other stops compiling.

## Windows calls

`src/main/powershell.ts` runs scripts with `-EncodedCommand`, so no quoting or escaping can break them. Values go in
as base64 JSON (`psArg` + `fromArg`), never pasted into script text. `toArray` normalizes PowerShell's habit of turning
one-item arrays into objects.

## Reading the network

`src/main/network/index.ts` (`NetworkService`) owns everything that reads or changes the connection.

- **Snapshot** (`info()`): one PowerShell call lists the adapters that are up and have a gateway, their addresses, DNS
  servers (static ones and the router's both come from the registry), DNS over HTTPS keys and the output of
  `netsh wlan show interfaces`.
- **Primary adapter** (`pickPrimary`): the real card with the lowest route metric. VPN and virtual adapters
  (`virtualLabel`: Radmin, Hamachi, ZeroTier, Tailscale, WireGuard, OpenVPN, VirtualBox, VMware, Hyper-V, WSL, or any
  adapter with no hardware behind it) only win when no real card is connected. Radmin VPN resets its own metric to 1 on
  every start, which is why the metric alone is not enough. They are listed apart on the Conexão page.
- **Path** (`path()`): pings the router and 1.1.1.1 and times a DNS lookup through the system's own servers, all in
  parallel.
- **Fixes** (`fix(id)`): flush DNS and renew IP need nothing; restarting the adapter and resetting the network stack
  require administrator mode and a native confirmation dialog whose default button is Cancel.
- **Ping monitor**: one sample per second (router + chosen internet target), the last 60 kept in the main process and
  pushed to the window as `ping:sample`. It stops when the Ping page closes and when the app quits.

### DNS

- **Presets** (`DNS_PRESETS`): automatic (the router's), Cloudflare, Google and Quad9, each with IPv4 and IPv6 servers
  and its DNS over HTTPS address. `currentPreset` and `dnsEncrypted` read the current state from the snapshot.
- **Timing** (`dnsMeasure()`): three lookups of popular names straight to each preset's first server (and to the
  router's), median kept. Node's resolver talks to the server directly, so the Windows cache does not hide the trip.
- **Applying** (`dnsApply()`, admin + confirmation): `Set-DnsClientServerAddress` (or `-ResetServerAddresses` for
  automatic), then DNS over HTTPS the way the Windows 11 Settings app stores it: a `DohFlags = 1` key ("encrypted
  only") per server under the adapter's
  `HKLM\SYSTEM\CurrentControlSet\Services\Dnscache\InterfaceSpecificParameters\{GUID}\DohInterfaceSettings`.
  Servers Windows does not know yet are registered first with `Add-DnsClientDohServerAddress`. Choosing another
  server or turning encryption off removes the old keys; the DNS cache is cleared at the end.
- Windows 10 has no per-adapter DNS over HTTPS, so there the switch is off and only the servers change.

## Security checklist

`src/main/security.ts` (`SecurityService`) gathers facts; `src/shared/security.ts` (`buildChecks`) turns them into
ten checks with status (em dia, aviso, dica, sem uso aqui), text and an optional action. Warnings sort first.

- **One PowerShell call** reads the firewall profiles, the current network's category, TCP ports listening beyond
  localhost (grouped by program), Remote Desktop (`fDenyTSConnections`, skipped on Home editions), SMBv1
  (`Get-SmbServerConfiguration`, registry fallback; unknown without admin), the user's proxy settings and the saved
  Wi-Fi profiles. Wi-Fi profiles are exported as XML (`netsh wlan export profile`), whose fields are the same in
  every Windows language, then deleted. The hosts file is read directly by Node.
- **Programs vs Windows**: `isSystemProcess` treats svchost, System, lsass and anything under `C:\Windows` as part of
  Windows. Only other programs count toward the open-ports warning.
- **Fixes** (admin + native confirmation): turn the firewall on, switch the network between Public and Private, turn
  SMBv1 off, block or unblock a program's inbound connections, forget a weak saved Wi-Fi network. Firewall rules the
  app creates carry the `net-sleuth` group, which is how "Desbloquear" finds them again. Block and forget only accept
  a program or network the last scan found, never an arbitrary value from the window.
- Things the app leaves to Windows open the right page instead: Remote Desktop and proxy settings, and the hosts
  file's folder.
- **Never done**: testing passwords, scanning other devices, reading traffic.
- `NET_SLEUTH_SECURITY_FIXTURE` points to a JSON file shaped like `SecurityFacts` to run the page with made-up facts.

## Saved passwords and QR codes

`src/main/vault.ts` (`VaultService`) keeps Wi-Fi and router passwords; `src/shared/vault.ts` has the types, the Wi-Fi
QR text and the validation.

- **Storage**: the whole list (names included) is one JSON document encrypted with Electron's `safeStorage`, which on
  Windows uses the account's DPAPI key, and written to `senhas.dat` in the data folder (next to the `.exe` in the
  portable build). Writes go to a temporary file first and replace the old one in one step. Copied to another PC or
  another Windows account, the file does not open, and the app says so instead of failing silently.
- **Passwords stay in the main process**: the window gets entries without passwords. It asks for one only when the
  user clicks "Mostrar". "Copiar" writes to the clipboard from the main process and wipes it after 30 seconds if the
  clipboard still holds that password.
- **QR code** (`src/main/wifi-card.ts`): the standard `WIFI:T:WPA;S:…;P:…;;` text (special characters escaped, `H:true`
  for hidden networks), encoded offline with `uqr` and sent to the window as an SVG path. The printable card is a
  script-free HTML page loaded in a hidden window: `webContents.print()` for "Imprimir cartão", and an offscreen
  window plus `capturePage()` for "Salvar imagem" (PNG).
- **Import from Windows**: saved Wi-Fi profiles are exported with `key=clear` as XML (same in every language). Profiles
  shared by all users only hand over the password in admin mode.
- **Router**: only stored and opened in the browser. The app never tries the password.

## Devices and intruder control

`src/main/devices.ts` (`DevicesService`) finds devices; `src/shared/devices.ts` merges what Windows sees with what
the user decided (names, known, blocked).

- **Finding devices**: one PowerShell call pings every address of the PC's own subnet at once with .NET
  `Ping.SendPingAsync` (no extra processes), which makes Windows refresh its table of neighbors, then reads that table
  (`Get-NetNeighbor`). Only entries Windows just confirmed count as online. `sweepRange` caps the sweep at the PC's
  /24 and only on home ranges (10/8, 172.16/12, 192.168/16): the app never pings addresses outside the user's own
  network. A reverse DNS lookup adds the name a device announces, when the router knows it.
- **Manufacturer**: the first half of the MAC address looked up in `resources/oui.txt.gz` (IEEE registry, built by
  `scripts/build-oui.mjs`, loaded the first time it is needed). Randomized ("private") addresses, which phones use, are
  shown as such instead of a wrong manufacturer.
- **Kind of device** (`src/main/discovery.ts`, `guessType` in `src/shared/devices.ts`): while the neighbor sweep runs,
  the app asks the network once, by multicast, the questions phones and smart TVs already ask: mDNS/Bonjour (Google
  Cast, AirPlay, printing, Spotify Connect, HomeKit/Matter, file sharing…) and UPnP/SSDP. Devices that answer say what
  they do and often their name and model. The same mDNS round also asks each address of the subnet "what is your
name?" (reverse lookup), which iPhones, Macs, Linux and many Windows PCs answer for themselves when the router does
not know their names. For UPnP the app reads the description file the device itself points to
  (only from that device, size-capped). No ports are probed and no device is contacted otherwise. The guess goes from
  strongest to weakest evidence: what the device announces (high), the name it gives the router (medium), the
  manufacturer or a private address (low). Anything below high shows as "(provável)", and the type the user picks
  always wins. Parsers live in `src/main/discovery-parse.ts`, tested with real packets.
- **Names from the router** (`src/main/routers/`, opt-in in Configurações or from the tip on Aparelhos): TP-Link
  EX/Aginet routers (EX141 and relatives) keep each device's DHCP name and system, but only share them through the
  web panel. When the user clicks "Atualizar lista", the app logs in the way the panel does, with the router password
  saved in Senhas e QR, reads `DEV2_HOST_ENTRY` and logs out. The panel's encryption (`tplink-ex-crypto.ts`) is
  AES-128-CBC for the payload plus a 512-bit unpadded RSA "signature" over the AES key, `md5("user" + password)` and a
  sequence number; the tests compare it byte for byte with values the router's own JavaScript produced. Safeguards:
  the gateway is checked first (`/cgi/getGDPRParm`, no login); if someone is already in the panel (`/cgi/getBusy`) the
  app does not log in, since the panel takes one administrator at a time; a refused password is never retried until
  it changes in Senhas e QR (the router locks after several wrong attempts); logout always runs; background scans never
  log in. Nothing on the router is changed. Router names take precedence over the device's own mDNS name, and the
  system the router reports ("Android", "Windows") feeds the type guess.
- **Memory**: `aparelhos.json` in the data folder keeps each MAC with its name, status, first and last time seen.
  The first scan only sets the baseline (everything is "Novo" and nothing is notified); afterwards, a MAC never seen
  before is "Novo" and triggers a Windows notification (scan every 5 minutes while the app is open; can be turned
  off in Configurações). New devices also show as a count next to Aparelhos in the sidebar.
- **Intruders**: the app never disconnects anyone itself. It guides blocking on the router (copy the MAC, open the
  panel, where to look), changing the Wi-Fi password (with a new QR code in Senhas e QR) or turning on a guest
  network. "Já bloqueei no roteador" only marks the device, and "Tirar a marca de bloqueado" undoes it, with the
  steps to unblock on the router. A blocked device that shows up again is flagged: the block did not take.
- `NET_SLEUTH_DEVICES_FIXTURE` points to a JSON list of `{ ip, mac, hostname }` to run the page with made-up neighbors,
  and `NET_SLEUTH_DISCOVERY_FIXTURE` to a JSON object of announcements by IP (`{ "192.168.0.31": { "upnp": … } }`).
  `NET_SLEUTH_ROUTER_FIXTURE` replaces the router's list with a JSON array of `RouterHost`.

### Windows in any language

Windows translates the output of `ping.exe` and `netsh`, so `src/main/network/parse.ts` avoids matching words:

- `ping`: the reply line is the one with `TTL=`; the time is the first `=N ms` or `<N ms` on it.
- `netsh wlan`: the SSID key, the signal as `N%`, the channel and authentication through small sets of translated
  labels, and the band from the channel number.

On Windows 11 24H2, `netsh wlan` needs location permission. When it is blocked the snapshot sets `wifiBlocked` and the
page offers to open the location settings.

### Judging the result

The verdicts live in `src/shared/network.ts` as pure functions, so they are tested without Windows:

- `diagnose(info, path)` walks adapter → address → router → DNS → internet, stops at the first failure and suggests
  the matching fix.
- `pingVerdict(samples)` compares the router line with the internet line over the last 20 seconds and says whether the
  problem is at home or at the provider.

Many routers ignore ping. When the router is silent but the internet answers, both treat the router as fine.

### Testing without Windows

`npm test` checks the parsers against real outputs in Portuguese, English, German and Spanish, plus the verdicts. Set
`NET_SLEUTH_FIXTURE` to a JSON file shaped like `NetInfo` to run the app with a made-up connection, such as Wi-Fi on a
PC that only has a cable.

## Shared with disk-sleuth

- Frameless window, custom title bar, light/dark/Windows themes with no white flash (`src/main/index.ts`).
- Administrator mode (`src/main/elevation.ts`): relaunch through UAC with `Start-Process -Verb RunAs`; in dev the old
  instance stays alive, windowless, to keep the Vite dev server up for the elevated copy.
- Portable build (`src/main/portable.ts`): settings live in a `net-sleuth - dados` folder next to the `.exe`, and an
  elevated relaunch keeps using it.
- Startup time is measured from process start to the window's first frame (`src/main/perf.ts`) and shown under
  Configurações › Sobre. Target: under 1.5 s.

## Pages

Every page except Conexão is lazy-loaded, so the first screen ships with the smallest bundle. Pages not built yet show
which phase brings them (`components/layout/ComingSoon.tsx`).

## Distribution

`npm run dist:win` writes `net-sleuth-<version>-installer.exe` (per-user NSIS installer in Brazilian Portuguese) and
`net-sleuth-<version>-portable.exe` to `release/`. Builds are not code-signed, so SmartScreen warns the first time.

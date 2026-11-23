<p align="center">
  <img src="resources/icon.png" width="96" height="96" alt="App icon: three signal bars on a dark tile">
</p>

<h1 align="center">net-sleuth</h1>

<p align="center">
  See how your Windows PC is connected, fix common network problems in one click, and check your network's security.
</p>

<p align="center">
  <img alt="Platform: Windows 10/11" src="https://img.shields.io/badge/platform-Windows%2010%20%7C%2011-0078d4">
  <a href="https://github.com/JvTadeo/net-sleuth/releases/latest"><img alt="Latest release" src="https://img.shields.io/github/v/release/JvTadeo/net-sleuth"></a>
  <a href="LICENSE"><img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-22c55e"></a>
  <img alt="Electron" src="https://img.shields.io/badge/Electron-45-47848f">
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-strict-3178c6">
</p>

---

A sibling of [disk-sleuth](https://github.com/JvTadeo/disk-sleuth): same look, same foundations, same way of shipping.

> The interface is in Brazilian Portuguese. The code, comments and docs are in English.

## Download

Get the latest version from the [Releases](https://github.com/JvTadeo/net-sleuth/releases/latest) page:

- **`net-sleuth-<version>-installer.exe`**: installs for your user (no administrator needed) and adds a Start menu entry.
- **`net-sleuth-<version>-portable.exe`**: runs from anywhere, nothing installed. Its data stays in a
  `net-sleuth - dados` folder next to the `.exe`.

Windows may warn that the app is from an unknown publisher, because the builds are not code-signed. Choose
"More info" → "Run anyway".

Most pages work as a normal user. Changing DNS, firewall rules, the network profile or resetting the network stack
needs administrator rights; the app offers to reopen itself as administrator when that is the case.

## Features

| Page | What it does |
| --- | --- |
| Conexão | Current network (cable or Wi-Fi), link speed, addresses, DNS, and the path PC → router → internet with the latency of each hop |
| Consertos | Automatic diagnosis, flush the DNS cache, renew the IP, restart the network adapter, reset the Windows network stack |
| DNS | Switch servers in one click (Cloudflare, Google, Quad9, automatic) and turn on encrypted DNS |
| Ping | Live latency chart to the router and to the internet, with a verdict on which side the problem is |
| Segurança | Checklist: firewall, network profile, open ports and the program behind each, Remote Desktop, SMBv1, hosts file, proxy, insecure saved Wi-Fi networks |
| Senhas e QR | Wi-Fi and router passwords kept encrypted by Windows, and a QR code so visitors join the Wi-Fi without typing |
| Aparelhos | Who is on your network, with the kind of device (TV, phone, printer…) and model when it announces them, names you give, a heads-up when a new device shows up, and guided blocking on the router (reversible) |

### What it does not do, on purpose

- Test router or Wi-Fi passwords, scan other devices for weaknesses, probe their ports, or capture network traffic
- Force devices off the network: only the router can block a device, and the app guides you there
- Promise virus protection: for that, use Windows Security

## Privacy and safety

- **Everything stays on your PC.** No account, no cloud, no telemetry. The app only talks to your own network, and to
  the internet for the ping and DNS measurements you start.
- **Saved passwords** are encrypted with your Windows account's key (DPAPI, through Electron `safeStorage`). The file
  only opens on the same PC and Windows account. Passwords are shown or copied only when you click, and copied ones are
  wiped from the clipboard after 30 seconds.
- **Finding devices** stays inside your home network: a ping to each address of your own subnet (home ranges only,
  at most 254 addresses), plus the standard mDNS/Bonjour and UPnP questions that phones and smart TVs already ask.
- **Reading names from the router** is off until you turn it on, and works with TP-Link EX/Aginet routers (such as the
  EX141). The app logs in with the panel password you saved, the same way the web panel does, reads the list of
  devices and logs out. It changes nothing, never logs in while someone else is in the panel, and stops after a
  refused password so the router does not lock you out. Use it only with your own router. The password travels only
  inside your home network, protected by the panel's own encryption, the same way it does when you use the browser.
- **Every change** to Windows settings asks for confirmation first, and the ones that can be undone show how
  (unblocking a program, going back to automatic DNS, unmarking a blocked device).

## Build from source

Requirements: Windows 10 or 11 and [Node.js](https://nodejs.org) 22.12 or newer.

```bash
npm install
npm run dev
```

| Script | What it does |
| --- | --- |
| `npm run dev` | Starts the app with hot reload |
| `npm run typecheck` | Type-checks the main, preload and renderer code |
| `npm test` | Runs the parser, diagnosis, security, saved-password and device tests (no Windows needed) |
| `npm run build` | Production build into `out/` |
| `npm run dist:win` | Builds the installer and the portable `.exe` into `release/` |

## Tech stack

[Electron](https://www.electronjs.org) · [React 19](https://react.dev) · TypeScript ·
[electron-vite](https://electron-vite.org) · [Tailwind CSS v4](https://tailwindcss.com) ·
[shadcn/ui](https://ui.shadcn.com) · [Remix Icon](https://remixicon.com) · [Zustand](https://zustand.docs.pmnd.rs) ·
[electron-builder](https://www.electron.build)

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for how it is put together.

## Credits

Manufacturer names on the Aparelhos page come from the IEEE OUI registry, packaged by
[oui-data](https://www.npmjs.com/package/oui-data) (BSD-2-Clause) and shrunk by `scripts/build-oui.mjs`.

## Roadmap

- [x] Phase 0: UI prototype
- [x] Phase 1: project foundation
- [x] Phase 2: connection, fixes and ping
- [x] Phase 3: DNS
- [x] Phase 4: security checklist
- [x] Phase 5: passwords and QR code
- [x] Phase 6: devices and intruder control
- [x] Phase 7: 1.0 release

Next, after 1.0: nearby Wi-Fi networks and channel advice, a speed test, and internet usage per program.

## License

[MIT](LICENSE) © João Vitor Tadeo

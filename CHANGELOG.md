# Changelog

## 1.0.0

First release. Seven pages in the sidebar, interface in Brazilian Portuguese.

- **Conexão**: current network (cable or Wi-Fi), link speed, addresses and DNS, and the path PC → router → DNS →
  internet with the latency of each hop. VPN and virtual adapters (Radmin, Hamachi, VirtualBox…) are listed apart and
  never taken for the main connection.
- **Consertos**: automatic diagnosis that points to the fix, plus flush DNS cache, renew IP, restart the network
  adapter and reset the Windows network stack (the last two need administrator rights and ask first).
- **DNS**: switch between automatic, Cloudflare, Google and Quad9 in one click, with each server's response time
  measured on your network, and turn on encrypted DNS (DNS over HTTPS) on Windows 11.
- **Ping**: live 60-second chart to the router and to the internet, with a verdict on whether a problem is at home or
  at the provider.
- **Segurança**: ten checks (open ports and the program behind each, encrypted DNS, firewall, network profile, Remote
  Desktop, SMBv1, hosts file, proxy, router password reminder, weak saved Wi-Fi networks). Fixes ask first and can be
  undone where it makes sense, such as blocking a program in the firewall.
- **Senhas e QR**: Wi-Fi and router passwords encrypted with your Windows account, Wi-Fi QR codes for visitors,
  printable card and PNG image, import from Windows' saved networks, strong password generator.
- **Aparelhos**: who is on your network, with manufacturer, kind of device and model when the device announces them
  (mDNS/Bonjour and UPnP), names from TP-Link EX/Aginet routers (opt-in), names you give, a Windows notification when a
  new device joins, and guided blocking on the router with undo.
- Installer (per user) and portable `.exe`, light, dark and system themes.

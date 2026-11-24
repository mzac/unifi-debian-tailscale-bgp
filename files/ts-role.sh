# /etc/profile.d/ts-role.sh: role banner for every interactive login shell (OpenSSH and Tailscale SSH;
# Tailscale SSH skips PAM, so /etc/update-motd.d never runs there).
case $- in *i*) [ -x /usr/local/sbin/ts-maint ] && timeout 8 /usr/local/sbin/ts-maint status --motd 2>/dev/null ;; esac

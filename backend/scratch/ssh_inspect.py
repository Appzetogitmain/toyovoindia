import paramiko
import sys

sys.stdout.reconfigure(encoding='utf-8')

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect('187.127.163.98', username='root', password='Toyovo@12345', timeout=10)

def run_cmd(cmd):
    
    err = stderr.read().decode()
    if out:
        print(out)
    if err:
        print("STDERR:", err)

run_cmd('pm2 list')
run_cmd('ls -la /var/www')
run_cmd('find /var/www /root /home -maxdepth 3 -iname "*toyovo*" 2>/dev/null')
run_cmd('cat /etc/nginx/sites-enabled/* | grep -E "server_name|proxy_pass|root "')

ssh.close()

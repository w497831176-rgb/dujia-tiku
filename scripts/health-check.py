#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
NAS 健康检查脚本

用法：
    python scripts/health-check.py
"""

import os
import paramiko
import sys


def info(msg):
    print(f"[INFO] {msg}")


def ok(msg):
    print(f"[OK] {msg}")


def fail(msg):
    print(f"[FAIL] {msg}")
    return False


def main():
    host = os.environ.get("NAS_HOST", "")
    port = int(os.environ.get("NAS_SSH_PORT", "246"))
    user = os.environ.get("NAS_USER", "")
    password = os.environ.get("NAS_PASSWORD", "")
    sudo_password = os.environ.get("NAS_SUDO_PASSWORD", password)

    if not host or not user or not password:
        fail("请通过环境变量提供 NAS_HOST、NAS_USER 和 NAS_PASSWORD")
        sys.exit(2)

    passed = 0
    failed = 0

    info("Connecting to NAS via SSH...")
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(host, port=port, username=user, password=password, timeout=30)

    # Check containers
    def check_containers():
        nonlocal passed, failed
        cmd = f'echo "{sudo_password}" | sudo -S /usr/local/bin/docker ps --format "{{{{.Names}}}}|{{{{.Status}}}}|{{{{.Ports}}}}"'
        stdin, stdout, stderr = client.exec_command(cmd, timeout=30)
        out = stdout.read().decode().strip()
        err = stderr.read().decode().strip()

        if err and 'Password:' not in err:
            fail(f"Docker ps error: {err}")
            failed += 1
            return

        lines = [l for l in out.split('\n') if l.strip()]
        expected = ['dujia-tiku-api', 'dujia-tiku-nginx', 'dujia-tiku-test-api', 'dujia-tiku-test-nginx']
        found = [l.split('|')[0] for l in lines]

        for name in expected:
            if name in found:
                ok(f"Container running: {name}")
                passed += 1
            else:
                fail(f"Container not running: {name}")
                failed += 1

    # Check HTTP endpoints
    def check_http(port_num, label):
        nonlocal passed, failed
        cmd = f'curl -s -o /dev/null -w "%{{http_code}}" http://localhost:{port_num}/'
        stdin, stdout, stderr = client.exec_command(cmd, timeout=30)
        out = stdout.read().decode().strip()
        if out == "200":
            ok(f"HTTP 200 on port {port_num} ({label})")
            passed += 1
        else:
            fail(f"Port {port_num} ({label}) returned {out}")
            failed += 1

    # Check API health
    def check_api_health(port_num, label):
        nonlocal passed, failed
        cmd = f'curl -s http://localhost:{port_num}/api/health'
        stdin, stdout, stderr = client.exec_command(cmd, timeout=30)
        out = stdout.read().decode().strip()
        if '"status":"ok"' in out:
            ok(f"API health ok on port {port_num} ({label})")
            passed += 1
        else:
            fail(f"API health failed on port {port_num} ({label}): {out}")
            failed += 1

    check_containers()
    prod_port = int(os.environ.get("PROD_PORT", "18080"))
    test_port = int(os.environ.get("TEST_PORT", "18082"))
    check_http(prod_port, "production")
    check_http(test_port, "test")
    check_api_health(prod_port, "production")
    check_api_health(test_port, "test")

    client.close()

    print()
    print(f"RESULT: {passed} passed, {failed} failed")
    if failed > 0:
        sys.exit(1)


if __name__ == "__main__":
    main()

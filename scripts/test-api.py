#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
API 端到端测试脚本

用法：
    python scripts/test-api.py --base-url http://localhost:18082
"""

import argparse
import requests
import sys
import uuid


def info(msg):
    print(f"[INFO] {msg}")


def ok(msg):
    print(f"[OK] {msg}")


def fail(msg):
    print(f"[FAIL] {msg}")
    return False


def main():
    parser = argparse.ArgumentParser(description="Dujiatiku API E2E Test")
    parser.add_argument("--base-url", default="http://localhost:18082", help="API base URL")
    args = parser.parse_args()

    base = args.base_url.rstrip("/")
    username = f"test_api_{uuid.uuid4().hex[:8]}"
    password = "Test123456"
    token = None
    passed = 0
    failed = 0

    info(f"Testing API at {base}")

    # 1. Health check
    try:
        r = requests.get(f"{base}/api/health", timeout=10)
        if r.status_code == 200 and r.json().get("status") == "ok":
            ok("Health check")
            passed += 1
        else:
            fail(f"Health check returned {r.status_code}: {r.text}")
            failed += 1
    except Exception as e:
        fail(f"Health check exception: {e}")
        failed += 1

    # 2. Register
    try:
        r = requests.post(f"{base}/api/auth/register", json={
            "username": username,
            "password": password,
            "confirmPassword": password
        }, timeout=10)
        if r.status_code == 200:
            token = r.json().get("token")
            ok(f"Register user {username}")
            passed += 1
        else:
            fail(f"Register failed: {r.status_code} {r.text}")
            failed += 1
            sys.exit(1)
    except Exception as e:
        fail(f"Register exception: {e}")
        failed += 1
        sys.exit(1)

    headers = {"Authorization": f"Bearer {token}"}

    # 3. Get current user
    try:
        r = requests.get(f"{base}/api/auth/me", headers=headers, timeout=10)
        if r.status_code == 200 and r.json().get("username") == username:
            ok("Get current user")
            passed += 1
        else:
            fail(f"Get current user failed: {r.status_code} {r.text}")
            failed += 1
    except Exception as e:
        fail(f"Get current user exception: {e}")
        failed += 1

    # 4. Get questions
    try:
        r = requests.get(f"{base}/api/questions", headers=headers, timeout=10)
        if r.status_code == 200:
            questions = r.json().get("questions", [])
            if len(questions) > 0:
                ok(f"Get questions: {len(questions)} questions")
                passed += 1
            else:
                fail("Get questions returned empty list")
                failed += 1
        else:
            fail(f"Get questions failed: {r.status_code} {r.text}")
            failed += 1
    except Exception as e:
        fail(f"Get questions exception: {e}")
        failed += 1

    # 5. Submit answer
    question_id = None
    if questions:
        q = questions[0]
        question_id = q["id"]
        options = q.get("options", {})
        first_option = list(options.keys())[0] if options else "A"
        try:
            r = requests.post(f"{base}/api/answers", headers=headers, json={
                "questionId": question_id,
                "selected": first_option
            }, timeout=10)
            if r.status_code == 200 and "isCorrect" in r.json():
                ok(f"Submit answer for question {question_id}")
                passed += 1
            else:
                fail(f"Submit answer failed: {r.status_code} {r.text}")
                failed += 1
        except Exception as e:
            fail(f"Submit answer exception: {e}")
            failed += 1

    # 6. Get answers
    try:
        r = requests.get(f"{base}/api/answers", headers=headers, timeout=10)
        if r.status_code == 200 and "answers" in r.json():
            ok("Get answers")
            passed += 1
        else:
            fail(f"Get answers failed: {r.status_code} {r.text}")
            failed += 1
    except Exception as e:
        fail(f"Get answers exception: {e}")
        failed += 1

    # 7. Reset answers
    try:
        r = requests.post(f"{base}/api/answers/reset", headers=headers, timeout=10)
        if r.status_code == 200:
            ok("Reset answers")
            passed += 1
        else:
            fail(f"Reset answers failed: {r.status_code} {r.text}")
            failed += 1
    except Exception as e:
        fail(f"Reset answers exception: {e}")
        failed += 1

    # Cleanup: delete test user directly from DB (requires SSH access)
    info(f"Test user {username} should be cleaned up manually or via health-check script")

    print()
    print(f"RESULT: {passed} passed, {failed} failed")
    if failed > 0:
        sys.exit(1)


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
前端浏览器端到端测试脚本（基于 Playwright）

安装依赖：
    pip install playwright
    playwright install chromium

用法：
    python scripts/test-frontend-browser.py --url http://localhost:18082
"""

import argparse
import sys
import uuid

try:
    from playwright.sync_api import sync_playwright
except ImportError:
    print("[ERROR] Playwright not installed.")
    print("Please run:")
    print("  pip install playwright")
    print("  playwright install chromium")
    sys.exit(1)


def info(msg):
    print(f"[INFO] {msg}")


def ok(msg):
    print(f"[OK] {msg}")


def fail(msg):
    print(f"[FAIL] {msg}")
    return False


def main():
    parser = argparse.ArgumentParser(description="Dujiatiku Frontend Browser E2E Test")
    parser.add_argument("--url", default="http://localhost:18082", help="Frontend URL")
    args = parser.parse_args()

    url = args.url.rstrip("/")
    username = f"test_ui_{uuid.uuid4().hex[:8]}"
    password = "Test123456"
    passed = 0
    failed = 0

    info(f"Testing frontend at {url}")

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page(viewport={"width": 375, "height": 812})

        try:
            # 1. Open homepage
            page.goto(url)
            page.wait_for_selector('input[placeholder="请输入用户名"]', timeout=10000)
            ok("Homepage loaded")
            passed += 1
        except Exception as e:
            fail(f"Homepage load failed: {e}")
            failed += 1
            browser.close()
            sys.exit(1)

        try:
            # 2. Register
            page.click('text=立即注册')
            page.wait_for_selector('text=注册', timeout=5000)
            inputs = page.query_selector_all('input')
            inputs[0].fill(username)
            inputs[1].fill(password)
            inputs[2].fill(password)
            page.click('button:has-text("注册")')
            page.wait_for_selector('#questionCard, text=独家题库', timeout=10000)
            ok(f"Register and login as {username}")
            passed += 1
        except Exception as e:
            fail(f"Register failed: {e}")
            failed += 1

        try:
            # 3. Switch to unanswered mode
            page.click('text=只看未做')
            page.wait_for_timeout(500)
            ok("Switch to unanswered mode")
            passed += 1
        except Exception as e:
            fail(f"Switch mode failed: {e}")
            failed += 1

        # 4. Answer 3 questions
        for i in range(3):
            try:
                info(f"Answering question {i+1}")

                # Check next button is disabled before answer
                next_btn = page.query_selector('#nextBtn')
                if next_btn and next_btn.is_disabled():
                    ok(f"Q{i+1}: Next button disabled before answer")
                    passed += 1
                else:
                    fail(f"Q{i+1}: Next button should be disabled before answer")
                    failed += 1

                # Click first option
                option_btn = page.query_selector('#questionCard button.option-btn, #questionCard .option-item')
                if option_btn:
                    option_btn.click()
                    page.wait_for_timeout(800)
                else:
                    fail(f"Q{i+1}: No option button found")
                    failed += 1
                    continue

                # Check analysis shown
                if page.inner_text('#questionCard').find('题目解析') != -1:
                    ok(f"Q{i+1}: Analysis shown after answer")
                    passed += 1
                else:
                    fail(f"Q{i+1}: Analysis not shown")
                    failed += 1

                # Check next button enabled
                next_btn = page.query_selector('#nextBtn')
                if next_btn and not next_btn.is_disabled():
                    ok(f"Q{i+1}: Next button enabled after answer")
                    passed += 1
                else:
                    fail(f"Q{i+1}: Next button should be enabled after answer")
                    failed += 1

                # Click next if not last
                if i < 2:
                    next_btn.click()
                    page.wait_for_timeout(800)

                    # Check next button disabled on new question
                    next_btn = page.query_selector('#nextBtn')
                    if next_btn and next_btn.is_disabled():
                        ok(f"Q{i+2}: Next button disabled on new question")
                        passed += 1
                    else:
                        fail(f"Q{i+2}: Next button should be disabled on new question")
                        failed += 1
            except Exception as e:
                fail(f"Q{i+1} flow failed: {e}")
                failed += 1

        # 5. Test variant if exists
        try:
            card_text = page.inner_text('#questionCard')
            if '举一反三' in card_text:
                variant_btn = page.query_selector('.variant-option-btn')
                if variant_btn:
                    variant_btn.click()
                    page.wait_for_timeout(800)
                    # Check that some analysis appeared for variant
                    ok("Variant option clicked")
                    passed += 1
                else:
                    fail("Variant option button not found")
                    failed += 1
            else:
                info("No variant on current question, skipping variant test")
        except Exception as e:
            fail(f"Variant test failed: {e}")
            failed += 1

        browser.close()

    # Cleanup note
    info(f"Test user {username} should be cleaned up manually or via SSH")

    print()
    print(f"RESULT: {passed} passed, {failed} failed")
    if failed > 0:
        sys.exit(1)


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""Capture reusable trainer screenshots for slides using headless Chromium."""

from __future__ import annotations

import asyncio
import contextlib
import io
import socketserver
import subprocess
import threading
import time
from http.server import SimpleHTTPRequestHandler
from pathlib import Path
from tempfile import TemporaryDirectory

from PIL import Image, ImageDraw
from pyppeteer import connect
from pyppeteer.chromium_downloader import chromium_executable


ROOT = Path("/Users/admin/Sites/google_disk_search/projects/sber/data-ai-trainer")
OUT_DIR = ROOT / "assets" / "screenshots"
CASE_URL = "/?case=legal-contract-review"
Image.MAX_IMAGE_PIXELS = None


class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, format: str, *args) -> None:  # noqa: A003
        return


@contextlib.contextmanager
def local_server(root: Path):
    class ReusableTCPServer(socketserver.TCPServer):
        allow_reuse_address = True

    handler = lambda *args, **kwargs: QuietHandler(*args, directory=str(root), **kwargs)  # noqa: E731
    with ReusableTCPServer(("127.0.0.1", 0), handler) as httpd:
        port = httpd.server_address[1]
        thread = threading.Thread(target=httpd.serve_forever, daemon=True)
        thread.start()
        try:
            yield port
        finally:
            httpd.shutdown()
            thread.join(timeout=2)


def rounded(image: Image.Image, radius: int) -> Image.Image:
    mask = Image.new("L", image.size, 0)
    draw = ImageDraw.Draw(mask)
    draw.rounded_rectangle((0, 0, image.width, image.height), radius=radius, fill=255)
    image.putalpha(mask)
    return image


def framed(image: Image.Image) -> Image.Image:
    canvas = Image.new("RGBA", (1600, 1067), (0, 0, 0, 0))
    draw = ImageDraw.Draw(canvas)

    shadow_box = (92, 96, 1508, 972)
    for blur, alpha in [(24, 24), (14, 30), (6, 36)]:
        draw.rounded_rectangle(
            (shadow_box[0] - blur, shadow_box[1] - blur, shadow_box[2] + blur, shadow_box[3] + blur),
            radius=38 + blur,
            fill=(19, 58, 32, alpha),
        )

    card = Image.new("RGBA", (1416, 876), (255, 255, 255, 242))
    card_draw = ImageDraw.Draw(card)
    card_draw.rounded_rectangle((0, 0, 1416, 876), radius=34, fill=(255, 255, 255, 248), outline=(220, 233, 216, 255), width=3)
    card_draw.rounded_rectangle((0, 0, 1416, 68), radius=34, fill=(245, 248, 242, 255))
    card_draw.rectangle((0, 34, 1416, 68), fill=(245, 248, 242, 255))

    for x, color in [(34, (255, 99, 71, 255)), (60, (255, 189, 46, 255)), (86, (39, 201, 63, 255))]:
        card_draw.ellipse((x, 24, x + 12, 36), fill=color)

    inner_max_w = 1330
    inner_max_h = 760
    scale = min(inner_max_w / image.width, inner_max_h / image.height)
    sized = image.resize((max(1, int(image.width * scale)), max(1, int(image.height * scale))), Image.LANCZOS).convert("RGBA")
    sized = rounded(sized, 22)
    x = (1416 - sized.width) // 2
    y = 88 + (inner_max_h - sized.height) // 2
    card.alpha_composite(sized, (x, y))
    canvas.alpha_composite(card, (92, 96))
    return canvas


def save_framed_image(raw_bytes: bytes, out_path: Path) -> None:
    raw = Image.open(io.BytesIO(raw_bytes)).convert("RGBA")
    framed(raw).save(out_path)


def save_cropped_image(full_image: Image.Image, clip: dict, dpr: float, out_path: Path) -> None:
    x = int(max(0, clip["x"]) * dpr)
    y = int(max(0, clip["y"]) * dpr)
    width = int(clip["width"] * dpr)
    height = int(clip["height"] * dpr)
    cropped = full_image.crop((x, y, x + width, y + height)).convert("RGBA")
    framed(cropped).save(out_path)


async def union_clip(page, selectors: list[str], *, pad: int = 12) -> dict:
    return await page.evaluate(
        """(payload) => {
          const selectors = payload.selectors;
          const pad = payload.pad;
          const rects = selectors
            .map((selector) => document.querySelector(selector))
            .filter(Boolean)
            .map((node) => node.getBoundingClientRect());
          const left = Math.max(0, Math.min(...rects.map((rect) => rect.left)) - pad + window.scrollX);
          const top = Math.max(0, Math.min(...rects.map((rect) => rect.top)) - pad + window.scrollY);
          const right = Math.max(...rects.map((rect) => rect.right)) + pad + window.scrollX;
          const bottom = Math.max(...rects.map((rect) => rect.bottom)) + pad + window.scrollY;
          return { x: left, y: top, width: right - left, height: bottom - top };
        }""",
        {"selectors": selectors, "pad": pad},
    )


async def capture_overlay(page, selectors: list[str], out_path: Path, *, width: int = 1150) -> None:
    await page.evaluate(
        """(payload) => {
          const old = document.getElementById('codex-capture-root');
          if (old) old.remove();

          const root = document.createElement('div');
          root.id = 'codex-capture-root';
          root.style.cssText = [
            'position: fixed',
            'inset: 0',
            'display: flex',
            'align-items: center',
            'justify-content: center',
            'padding: 48px',
            'z-index: 999999',
            'pointer-events: none'
          ].join(';');

          const surface = document.createElement('div');
          surface.style.cssText = [
            `width: ${payload.width}px`,
            'display: flex',
            'flex-direction: column',
            'gap: 18px',
            'padding: 24px',
            'border-radius: 28px',
            'background: rgb(255,255,255)',
            'box-shadow: 0 18px 50px rgba(19, 58, 32, 0.12)'
          ].join(';');

          payload.selectors.forEach((selector) => {
            const node = document.querySelector(selector);
            if (!node) return;
            const clone = node.cloneNode(true);
            surface.appendChild(clone);
          });

          root.appendChild(surface);
          document.body.appendChild(root);
        }""",
        {"selectors": selectors, "width": width},
    )
    await asyncio.sleep(0.2)
    clip = await page.evaluate(
        """() => {
          const rect = document.querySelector('#codex-capture-root > div').getBoundingClientRect();
          return { x: rect.left, y: rect.top, width: rect.width, height: rect.height };
        }"""
    )
    raw = await page.screenshot({"clip": clip, "type": "png"})
    save_framed_image(raw, out_path)
    await page.evaluate(
        """() => {
          const root = document.getElementById('codex-capture-root');
          if (root) root.remove();
        }"""
    )


async def capture() -> None:
    with TemporaryDirectory(prefix="trainer_chrome_") as user_data_dir:
        chrome = subprocess.Popen(
            [
                chromium_executable(),
                "--headless",
                "--disable-gpu",
                "--hide-scrollbars",
                "--remote-debugging-port=9222",
                f"--user-data-dir={user_data_dir}",
                "about:blank",
            ],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        browser = None
        try:
            for _ in range(50):
                try:
                    browser = await connect(
                        browserURL="http://127.0.0.1:9222",
                        defaultViewport={"width": 1560, "height": 1900, "deviceScaleFactor": 2},
                    )
                    break
                except Exception:
                    time.sleep(0.2)
            if browser is None:
                raise RuntimeError("Could not connect to local Chromium for screenshots.")

            page = await browser.newPage()
            await page.setViewport({"width": 1560, "height": 1900, "deviceScaleFactor": 2})
            await page.goto(capture.page_url, {"waitUntil": "networkidle2"})
            await page.waitForSelector("#metric-picker")
            await page.waitForSelector("#project-result")
            await asyncio.sleep(1.5)

            dpr = await page.evaluate("window.devicePixelRatio || 1")
            full_raw = await page.screenshot({"fullPage": True, "type": "png"})
            full_image = Image.open(io.BytesIO(full_raw)).convert("RGBA")

            await capture_overlay(page, [".hero", "#case-summary", "#metric-picker"], OUT_DIR / "trainer-step1-overview.png", width=1180)

            for selectors, filename in [
                (["#metric-tree .tree-columns"], "trainer-step2-tree.png"),
                (["#source-pickers .signal-grid"], "trainer-step3-sources.png"),
                (["#route-comparison .comparison-grid"], "trainer-step4-routes.png"),
                (["#project-result .formula-grid", "#project-result .result-grid"], "trainer-step5-result.png"),
            ]:
                await capture_overlay(page, selectors, OUT_DIR / filename)
        finally:
            if browser is not None:
                await browser.disconnect()
            chrome.terminate()
            try:
                chrome.wait(timeout=5)
            except subprocess.TimeoutExpired:
                chrome.kill()


def main() -> int:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    with local_server(ROOT) as port:
        capture.page_url = f"http://127.0.0.1:{port}{CASE_URL}"  # type: ignore[attr-defined]
        asyncio.run(capture())
    print(f"Saved screenshots to {OUT_DIR}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

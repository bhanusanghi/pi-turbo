"""Shared visual grammar and measured timing for the full explanatory film."""
from pathlib import Path
import json
import numpy as np
from manim import *

HERE = Path(__file__).resolve().parent
BG = "#0B101B"
PANEL = "#111B2A"
MUTED = "#9AAAC1"
BLUE = "#81AAFF"
CYAN = "#65D8E9"
AMBER = "#F5BC64"
GREEN = "#7DDCB4"
PURPLE = "#B49AFF"
GRAY = "#65748A"


def text(words, size=26, color=WHITE, font="Avenir Next"):
    return Text(words, font=font, font_size=size, color=color)


def fit(obj, width):
    if obj.width > width:
        obj.scale_to_fit_width(width)
    return obj


def panel(title, lines=(), color=BLUE, width=3.5, height=1.55, size=25):
    if isinstance(lines, str):
        lines = lines.split("\n")
    box = RoundedRectangle(width=width, height=height, corner_radius=0.15,
                           stroke_color=color, stroke_width=1.8,
                           fill_color=PANEL, fill_opacity=1)
    heading = fit(text(title, 17, color), width - 0.35)
    heading.move_to(box.get_top() + DOWN * 0.28)
    bodies = VGroup(*(fit(text(line, size), width - 0.4) for line in lines))
    bodies.arrange(DOWN, buff=0.12).move_to(box.get_center() + DOWN * 0.13)
    if bodies.height > height - 0.65:
        bodies.scale_to_fit_height(height - 0.65)
    return VGroup(box, heading, bodies)


def badge(words, color=CYAN, width=2.5, height=0.5, size=21):
    box = RoundedRectangle(width=width, height=height, corner_radius=0.12,
                           stroke_color=color, stroke_width=1.6,
                           fill_color=color, fill_opacity=0.08)
    words_obj = fit(text(words, size, color), width - 0.25).move_to(box)
    return VGroup(box, words_obj)


def model(words="System One", sub="decision driver", color=CYAN, radius=1.0):
    halo = Circle(radius=radius + 0.14, color=color, stroke_width=1, stroke_opacity=0.16)
    ring = Circle(radius=radius, color=color, stroke_width=2.5,
                  fill_color=color, fill_opacity=0.04)
    labels = VGroup(fit(text(words, 25, color), 2 * radius - 0.15),
                    fit(text(sub, 17, MUTED), 2 * radius - 0.15)).arrange(DOWN, buff=0.15)
    return VGroup(halo, ring, labels)


def link(a, b, color=GREEN, buff=0.15, **kwargs):
    start = a.get_right() if hasattr(a, "get_right") else a
    end = b.get_left() if hasattr(b, "get_left") else b
    return Arrow(start, end, buff=buff, color=color, stroke_width=2.4, **kwargs)


def route(points, color=AMBER):
    path = VMobject(color=color, stroke_width=2.4).set_points_as_corners(points)
    tip = Arrow(points[-2], points[-1], buff=0, color=color, stroke_width=2.4)
    return VGroup(path, tip), path


def code_card(title, lines, owner="YOUR CODE", color=BLUE, width=7.5, height=3.6, size=23):
    box = RoundedRectangle(width=width, height=height, corner_radius=0.14,
                           stroke_color=color, stroke_width=1.8,
                           fill_color=PANEL, fill_opacity=1)
    name = text(title, 24, color).move_to(box.get_top() + DOWN * 0.32)
    owner_label = fit(text(f"{owner}  /  PSEUDOCODE", 13, MUTED), width - 0.4)
    owner_label.move_to(box.get_bottom() + UP * 0.22)
    rows = VGroup()
    for line in lines:
        content = Text(line or " ", font="Menlo", font_size=size,
                       color=WHITE, disable_ligatures=True)
        rows.add(content)
    rows.arrange(DOWN, aligned_edge=LEFT, buff=0.16)
    fit(rows, width - 0.6)
    if rows.height > height - 1.15:
        rows.scale_to_fit_height(height - 1.15)
    rows.move_to(box.get_center() + DOWN * 0.03).align_to(box, LEFT).shift(RIGHT * 0.3)
    return VGroup(box, name, rows, owner_label)


class FilmScene(Scene):
    def begin(self, scene_id, headline=None):
        self.camera.background_color = BG
        timing = json.loads((HERE / "timing.json").read_text())
        self.data = timing["by_id"][scene_id]
        self.story = next(s for s in json.loads((HERE / "script.json").read_text())["scenes"]
                          if s["id"] == scene_id)
        self.slot = self.data["duration"]
        self.header = fit(text(headline or self.story["title"], 36), 12.6).move_to([0, 2.8, 0])
        brand_words = "FAST JUDGMENTS / DEEPER HELP" if int(scene_id[:2]) < 6 else "PI TURBO / ILLUSTRATIVE WORKFLOW"
        brand = text(brand_words, 14, MUTED).to_edge(UP, buff=0.34).to_edge(LEFT, buff=0.6)
        counter = text(f"{scene_id[:2]} / 12", 15, MUTED).move_to([5.95, 3.55, 0])
        self.sources = fit(text(" · ".join(self.story.get("source_labels", [])), 13, GRAY), 12.5)
        self.sources.move_to([0, -3.73, 0])
        self.add(brand, counter, self.sources)
        self.play(FadeIn(self.header, shift=UP * 0.08), run_time=0.6)

    def at(self, seconds):
        remaining = seconds - self.time
        if remaining > 0.012:
            self.wait(remaining)

    def cue(self, paragraph, fraction=0, offset=0):
        p = self.data["paragraphs"][paragraph]
        self.at(p["audio_start"] + p["audio_seconds"] * fraction + offset)

    def fraction(self, amount):
        self.at(self.slot * amount)

    def new_title(self, words, run_time=0.5):
        self.play(Transform(self.header, fit(text(words, 36), 12.6).move_to(self.header)), run_time=run_time)

    def send(self, path, color=CYAN, run_time=0.75):
        packet = Dot(path.get_start(), radius=0.075, color=color)
        self.add(packet)
        self.play(MoveAlongPath(packet, path, rate_func=smooth), run_time=run_time)
        self.remove(packet)

    def note(self, words, color=MUTED, y=-3.17, size=23):
        return fit(text(words, size, color), 12.6).move_to([0, y, 0])

    def finish(self):
        left = self.slot - self.time
        if left < -0.12:
            raise RuntimeError(f"{type(self).__name__} overruns its measured slot by {-left:.2f}s")
        if left > 0.012:
            self.wait(left)

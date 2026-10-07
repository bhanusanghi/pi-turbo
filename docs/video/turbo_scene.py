"""Manim Community starter for the LATE architecture section (after 3:15).
Not the revised opening or complete film. Schematic, not a measured runtime trace.

Render after installing Manim Community in an isolated environment:
    python -m manim -ql docs/video/turbo_scene.py TurboLoopPreview
No narration or external tools/model calls; Text avoids a LaTeX dependency.
"""
from manim import (
    Scene, VGroup, RoundedRectangle, Text, Arrow, CurvedArrow, Dot,
    FadeIn, FadeOut, Create, Transform, Indicate, MoveAlongPath,
    LEFT, RIGHT, UP, DOWN, WHITE,
)

AUTHOR = "#74A9FF"
TURBO = "#B49AFF"
PI = "#7DDCB4"
SYSTEM1 = "#65D8E9"
SYSTEM2 = "#F5BC64"
BACKGROUND = "#0B101A"


def card(title, subtitle, color, width=3.0):
    outline = RoundedRectangle(width=width, height=1.25, corner_radius=0.13,
                               stroke_color=color, fill_color=BACKGROUND,
                               fill_opacity=1)
    main = Text(title, font_size=23, color=color)
    sub = Text(subtitle, font_size=15, color=WHITE)
    labels = VGroup(main, sub).arrange(DOWN, buff=0.15)
    if labels.width > width - 0.3:
        labels.scale_to_fit_width(width - 0.3)
    labels.move_to(outline)
    return VGroup(outline, labels)


class TurboLoopPreview(Scene):
    def construct(self):
        self.camera.background_color = BACKGROUND
        title = Text("Bring your judgment. Reuse the harness.", font_size=32)
        title.to_edge(UP, buff=0.45)
        subtitle = Text("ILLUSTRATIVE FLOW / NOT A BENCHMARK", font_size=13,
                        color="#9BAABD").next_to(title, DOWN, buff=0.18)
        self.play(FadeIn(title), FadeIn(subtitle))

        ticket = card("AUTHOR input", "T42: charged twice", AUTHOR).shift(LEFT * 4.55 + UP * 0.7)
        driver = card("Chat model", "Ordinary Pi driver", SYSTEM2).shift(UP * 0.7)
        executor = card("PI execution", "Registered tools + hooks", PI).shift(RIGHT * 4.55 + UP * 0.7)
        first = Arrow(ticket.get_right(), driver.get_left(), buff=0.12, color=AUTHOR)
        second = Arrow(driver.get_right(), executor.get_left(), buff=0.12, color=PI)
        self.play(FadeIn(ticket))
        self.play(Create(first), FadeIn(driver))
        self.play(Create(second), FadeIn(executor))
        self.wait(1.5)

        new_driver = card("System 1 / Jev", "Typed judgment", SYSTEM1).move_to(driver)
        self.play(Transform(driver, new_driver), run_time=1.2)
        bridge = Text("TURBO: prepare -> judge -> resolve", font_size=21,
                      color=TURBO).shift(UP * 1.85)
        self.play(FadeIn(bridge))
        token = Dot(ticket.get_right(), radius=0.08, color=AUTHOR)
        self.play(FadeIn(token))
        self.play(MoveAlongPath(token, first), run_time=1)
        choice = Text("assign_payments", font_size=18, color=SYSTEM1).next_to(second, UP)
        self.play(FadeIn(choice), Indicate(driver))
        self.play(MoveAlongPath(token, second), run_time=1)
        receipt = Text("actual receipt -> author's state", font_size=18, color=PI).shift(DOWN * 0.25)
        self.play(FadeIn(receipt), Indicate(executor))
        self.wait(2)

        self.play(FadeOut(token), FadeOut(choice), FadeOut(receipt))
        helper = card("System 2 / native Pi Agent", "Scoped task + permitted Pi tools", SYSTEM2,
                      width=4.3).shift(DOWN * 1.7)
        consultation = Arrow(driver.get_bottom(), helper.get_top(), buff=0.13, color=SYSTEM2)
        self.play(Create(consultation), FadeIn(helper))
        reads = Text("read_order -> read_service_status", font_size=18,
                     color=PI).next_to(helper, DOWN, buff=0.23)
        self.play(FadeIn(reads))
        self.wait(2)
        back = CurvedArrow(helper.get_right(), driver.get_right(), angle=1.4,
                           color=SYSTEM1)
        back_label = Text("findings + tool evidence", font_size=16, color=SYSTEM1)
        back_label.shift(RIGHT * 3.3 + DOWN * 0.9)
        self.play(Create(back), FadeIn(back_label))
        self.play(Indicate(driver, color=SYSTEM1))
        self.wait(2)
        self.play(FadeOut(reads))
        footer = Text("AUTHOR state / questions / mappings     PI harness     TURBO orchestration",
                      font_size=16, color="#C4D0DE").to_edge(DOWN, buff=0.35)
        self.play(FadeIn(footer))
        self.wait(3)

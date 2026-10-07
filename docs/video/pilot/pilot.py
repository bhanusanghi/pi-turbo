"""Original explanatory animation. Illustrative workflow, not a live runtime trace."""
from pathlib import Path
import json
import numpy as np
from manim import (
    Scene, VGroup, VMobject, RoundedRectangle, Circle, Text, Arrow, Line, Dot,
    FadeIn, FadeOut, Create, Transform, ReplacementTransform, Indicate,
    MoveAlongPath, AnimationGroup, LEFT, RIGHT, UP, DOWN, WHITE, ORIGIN,
    smooth, linear,
)

HERE = Path(__file__).resolve().parent
BG = "#0B101B"
PANEL = "#111B2A"
MUTED = "#9AAAC1"
BLUE = "#81AAFF"
CYAN = "#65D8E9"
AMBER = "#F5BC64"
GREEN = "#7DDCB4"
PURPLE = "#B49AFF"


def label(text, size=24, color=WHITE):
    return Text(text, font="Avenir Next", font_size=size, color=color)


def pill(text, color, width=2.3, height=0.48):
    box = RoundedRectangle(width=width, height=height, corner_radius=0.13,
                           stroke_color=color, stroke_width=1.5,
                           fill_color=color, fill_opacity=0.09)
    words = label(text, 20, color).move_to(box)
    if words.width > width - 0.25:
        words.scale_to_fit_width(width - 0.25)
    return VGroup(box, words)


def card(title, body, color, width=3.3, height=1.5, body_size=26):
    box = RoundedRectangle(width=width, height=height, corner_radius=0.16,
                           stroke_color=color, stroke_width=1.8,
                           fill_color=PANEL, fill_opacity=1)
    name = label(title, 17, color).move_to(box.get_top() + DOWN * 0.3)
    words = label(body, body_size).move_to(box.get_center() + DOWN * 0.14)
    if words.width > width - 0.4:
        words.scale_to_fit_width(width - 0.4)
    return VGroup(box, name, words)


class TurboPilot(Scene):
    def begin_beat(self, beat_id):
        self.beat = self.beats[beat_id]
        self.beat_start = self.time

    def at(self, seconds):
        remaining = self.beat_start + seconds - self.time
        if remaining > 0.01:
            self.wait(remaining)

    def finish_beat(self):
        remaining = self.beat_start + self.beat["duration"] - self.time
        if remaining < -0.1:
            raise RuntimeError(f'Visuals overran {self.beat["id"]} by {-remaining}s')
        if remaining > 0.01:
            self.wait(remaining)

    def headline(self, text, number, run_time=0.45):
        replacement = label(text, 36).move_to([0, 2.8, 0])
        if replacement.width > 12.5:
            replacement.scale_to_fit_width(12.5)
        step = label(f"{number:02d} / 07", 15, MUTED).move_to([5.9, 3.55, 0])
        self.play(Transform(self.title, replacement), Transform(self.step, step), run_time=run_time)

    def send(self, path, color, run_time=0.65):
        packet = Dot(path.get_start(), radius=0.07, color=color)
        self.add(packet)
        self.play(MoveAlongPath(packet, path, rate_func=smooth), run_time=run_time)
        self.remove(packet)

    def construct(self):
        self.camera.background_color = BG
        timing = json.loads((HERE / "timing.json").read_text())
        self.beats = {p["id"]: p for p in timing["segments"]}
        self.add_sound(str(HERE / "audio/narration.wav"))
        brand = label("PI TURBO   /   ILLUSTRATIVE WORKFLOW", 14, MUTED)
        brand.to_edge(UP, buff=0.34).to_edge(LEFT, buff=0.6)
        self.title = label("A label is not an outcome.", 36).move_to([0, 2.8, 0])
        self.step = label("01 / 07", 15, MUTED).move_to([5.9, 3.55, 0])
        baseline = Line([-6.5, -3.55, 0], [6.5, -3.55, 0], color="#233248", stroke_width=1)
        self.add(brand, self.step, baseline)

        # 1: Begin with the ordinary problem, before naming the components.
        self.begin_beat("problem")
        self.play(FadeIn(self.title, shift=UP * 0.1), run_time=0.6)
        ticket = card("INCOMING TICKET", "Charged twice", BLUE, width=3.5, height=1.7)
        ticket.move_to([-4.5, 0.45, 0])
        self.play(FadeIn(ticket, shift=RIGHT * 0.4), run_time=0.75)
        choices = VGroup(*(pill(t, CYAN if i == 0 else MUTED, 2.3)
                           for i, t in enumerate(["Payments", "Technical", "SOS"])))
        choices.arrange(DOWN, buff=0.25).move_to([-0.5, 0.45, 0])
        self.at(2.0)
        first_preview = Arrow(ticket.get_right(), choices.get_left(), buff=0.18, color=BLUE)
        self.play(Create(first_preview), FadeIn(choices), run_time=0.8)
        self.at(4.1)
        outcome = card("RECORDED RESULT", "Assigned to a team", GREEN, height=1.3, body_size=24)
        outcome.move_to([4.45, 0.45, 0])
        preview_action = Arrow(choices.get_right(), outcome.get_left(), buff=0.18, color=GREEN)
        self.play(Create(preview_action), FadeIn(outcome), run_time=0.8)
        self.at(6.2)
        outcome_underline = label("Decision → action → receipt", 25, GREEN).move_to([0, -1.55, 0])
        self.play(FadeIn(outcome_underline), run_time=0.45)
        self.finish_beat()

        # 2: Introduce the driver only when the narration reaches it.
        self.begin_beat("routine")
        self.headline("Familiar case. Direct action.", 2)
        self.play(FadeOut(first_preview), FadeOut(preview_action), FadeOut(choices),
                  FadeOut(outcome), FadeOut(outcome_underline),
                  ticket.animate.move_to([-4.7, 0.75, 0]), run_time=0.55)
        halo = Circle(radius=1.14, color=CYAN, stroke_width=1, stroke_opacity=0.18)
        ring = Circle(radius=1.0, color=CYAN, stroke_width=2.5,
                      fill_color=CYAN, fill_opacity=0.045)
        driver_words = VGroup(label("System One", 25, CYAN), label("decision driver", 17, MUTED))
        driver_words.arrange(DOWN, buff=0.15)
        driver = VGroup(halo, ring, driver_words).move_to([-0.65, 0.75, 0])
        into_driver = Arrow(ticket.get_right(), driver.get_left(), buff=0.17, color=BLUE)
        question = label("Which team?", 20, MUTED).move_to([-0.65, -0.55, 0])
        self.play(Create(into_driver), FadeIn(driver), FadeIn(question), run_time=0.7)
        selection = pill("Payments", CYAN).move_to([-0.65, -1.0, 0])
        self.at(2.35)
        self.play(FadeIn(selection, shift=DOWN * 0.1), Indicate(ring, color=CYAN), run_time=0.65)
        pi = card("PI EXECUTES", "Assign ticket", GREEN, height=1.5, body_size=28)
        pi.move_to([4.45, 0.75, 0])
        to_pi = Arrow(driver.get_right(), pi.get_left(), buff=0.17, color=GREEN)
        self.at(3.6)
        self.play(Create(to_pi), FadeIn(pi), run_time=0.6)
        self.send(to_pi, CYAN, 0.6)
        receipt = card("RESULT RECORDED", "Payments team", GREEN, height=1.15, body_size=23)
        receipt.move_to([4.45, -1.15, 0])
        receipt_link = Arrow(pi.get_bottom(), receipt.get_top(), buff=0.1, color=GREEN)
        self.at(5.7)
        self.play(Create(receipt_link), FadeIn(receipt), run_time=0.7)
        self.finish_beat()

        # 3: Change the input, not the definition of who drives the workflow.
        self.begin_beat("ambiguous")
        self.headline("Changed facts. Missing evidence.", 3)
        self.play(FadeOut(receipt), FadeOut(receipt_link), FadeOut(selection),
                  to_pi.animate.set_opacity(0.2), pi.animate.set_opacity(0.35), run_time=0.6)
        changed_ticket = card("INCOMING TICKET", "Payment failed.\nService is down.", BLUE,
                              width=3.5, height=1.7, body_size=25).move_to(ticket)
        self.at(1.25)
        self.play(Transform(ticket, changed_ticket), run_time=0.7)
        self.send(into_driver, BLUE, 0.65)
        self.at(4.1)
        missing = pill("Need evidence", AMBER, width=2.6).move_to([-0.65, -1, 0])
        self.play(FadeIn(missing), run_time=0.55)
        self.finish_beat()

        # 4: Reveal the optional helper and its deliberately permitted scope.
        self.begin_beat("consult")
        self.headline("Ask for deeper help when needed.", 4)
        helper = card("SYSTEM TWO", "Investigate", AMBER, width=3.0, height=1.1, body_size=25)
        helper.move_to([-0.65, -2.3, 0])
        enabled = label("enabled by you", 16, AMBER).next_to(helper, DOWN, buff=0.13)
        consult_route = VMobject(color=AMBER, stroke_width=2.5).set_points_as_corners([
            driver.get_right(), [1.5, 0.75, 0], [1.5, -1.48, 0], [0.45, -1.75, 0]])
        consult_tip = Arrow([1.5, -1.48, 0], [0.45, -1.75, 0], buff=0,
                            color=AMBER, stroke_width=2.5)
        consult_path = VGroup(consult_route, consult_tip)
        self.at(1.0)
        self.play(FadeIn(helper, shift=DOWN * 0.15), FadeIn(enabled), Create(consult_path), run_time=0.8)
        self.at(2.4)
        self.send(consult_route, AMBER, 0.75)
        tool_scope = card("PERMITTED PI TOOLS", "Order  ·  Service", GREEN, height=1.2, body_size=23)
        tool_scope.move_to([4.45, -2.3, 0])
        helper_to_tools = Arrow(helper.get_right(), tool_scope.get_left(), buff=0.16, color=GREEN)
        self.at(4.25)
        self.play(Create(helper_to_tools), FadeIn(tool_scope), run_time=0.75)
        self.finish_beat()

        # 5: Show facts changing. Avoid making the helper a second main driver.
        self.begin_beat("evidence")
        self.headline("Check facts. Return evidence.", 5)
        self.send(helper_to_tools, AMBER, 0.65)
        order = card("PI TOOL RESULT", "Order: payment failed", GREEN, height=1.2, body_size=22)
        order.move_to(tool_scope)
        self.at(1.3)
        self.play(Transform(tool_scope, order), run_time=0.55)
        service = card("PI TOOL RESULT", "Service: outage", GREEN, height=1.2, body_size=24)
        service.move_to(tool_scope)
        self.at(2.6)
        self.play(Transform(tool_scope, service), run_time=0.55)
        evidence = pill("Outage confirmed", AMBER, width=2.8, height=0.62).move_to(tool_scope)
        self.at(4.1)
        self.play(ReplacementTransform(tool_scope, evidence), run_time=0.6)
        return_path = Line(evidence.get_center(), helper.get_center())
        self.play(MoveAlongPath(evidence, return_path), FadeOut(helper_to_tools),
                  FadeOut(helper), FadeOut(enabled), FadeOut(consult_path), run_time=0.85)
        self.finish_beat()

        # 6: The evidence returns to System One; Pi executes the next chosen action.
        self.begin_beat("return")
        self.headline("The driver decides again.", 6)
        self.play(FadeOut(missing), run_time=0.3)
        evidence_route = Line(evidence.get_center(), driver.get_center())
        self.play(MoveAlongPath(evidence, evidence_route), run_time=0.8)
        self.play(FadeOut(evidence), Indicate(ring, color=CYAN), run_time=0.6)
        sos = pill("SOS", CYAN).move_to([-0.65, -1, 0])
        policy_note = label("outage → SOS  /  your policy", 17, BLUE).move_to([-0.65, -1.65, 0])
        self.at(2.5)
        self.play(FadeIn(sos), FadeIn(policy_note), run_time=0.55)
        self.at(3.8)
        self.play(to_pi.animate.set_opacity(1), pi.animate.set_opacity(1), run_time=0.45)
        self.send(to_pi, CYAN, 0.65)
        receipt2 = card("RESULT RECORDED", "SOS team assigned", GREEN, height=1.15, body_size=23)
        receipt2.move_to([4.45, -1.15, 0])
        receipt_link2 = Arrow(pi.get_bottom(), receipt2.get_top(), buff=0.1, color=GREEN)
        self.at(5.75)
        self.play(Create(receipt_link2), FadeIn(receipt2), run_time=0.6)
        self.finish_beat()

        # 7: Reveal ownership and composition after the viewer understands the flow.
        self.begin_beat("close")
        self.headline("Your logic. A reusable agent foundation.", 7)
        board = VGroup(ticket, into_driver, driver, question, sos, policy_note,
                       to_pi, pi, receipt2, receipt_link2)
        self.play(board.animate.scale(0.78).move_to([0, 0.4, 0]), run_time=0.7)
        boundary = RoundedRectangle(width=12.6, height=3.5, corner_radius=0.18,
                                    stroke_color=PURPLE, stroke_width=1.6,
                                    fill_opacity=0).move_to([0, 0.5, 0])
        turbo_name = label("Turbo  ·  coordinates the flow", 22, PURPLE).move_to([0, 2.12, 0])
        self.play(Create(boundary), FadeIn(turbo_name), run_time=0.7)
        author = pill("Your policy + relevant state", BLUE, width=3.7, height=0.56)
        author.move_to([-4.1, -0.85, 0])
        self.at(2.8)
        self.play(FadeIn(author), run_time=0.55)
        foundation = RoundedRectangle(width=12.6, height=0.7, corner_radius=0.13,
                                      stroke_color=GREEN, fill_color=GREEN, fill_opacity=0.07)
        foundation.move_to([0, -1.8, 0])
        pi_name = label("Pi  ·  tools  ·  sessions  ·  recorded results", 23, GREEN).move_to(foundation)
        foundation_link = Arrow(boundary.get_bottom(), foundation.get_top(), buff=0.06, color=GREEN)
        self.at(4.2)
        self.play(Create(foundation_link), FadeIn(foundation), FadeIn(pi_name), run_time=0.65)
        extension = pill("Other Pi extensions", GREEN, width=3.8, height=0.56).move_to([-2.6, -2.8, 0])
        mcp = pill("Your connected MCP tools", GREEN, width=4.3, height=0.56).move_to([2.6, -2.8, 0])
        ext_link = Arrow(extension.get_top(), foundation.get_bottom() + LEFT * 2.6, buff=0.07, color=GREEN)
        mcp_link = Arrow(mcp.get_top(), foundation.get_bottom() + RIGHT * 2.6, buff=0.07, color=GREEN)
        self.at(6.3)
        self.play(FadeIn(extension), FadeIn(mcp), Create(ext_link), Create(mcp_link), run_time=0.7)
        self.at(9.25)
        closing = label("Fast judgments drive. Deeper reasoning helps.", 24, CYAN).move_to([0, -3.4, 0])
        self.play(FadeIn(closing, shift=UP * 0.08), run_time=0.65)
        self.finish_beat()

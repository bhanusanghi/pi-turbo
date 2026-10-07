"""The problem, audience, human learning analogy and typed AI models."""
from common import *


def invoice_ticket(width=4.55, height=2.55):
    return panel("T42  ·  CUSTOMER MESSAGE", [
        "Hi, I think May’s invoice",
        "was charged twice. My bank shows",
        "two debits of ₹2,499. Screenshot",
        "attached — please help with a refund."
    ], BLUE, width=width, height=height, size=23)


class Scene01(FilmScene):
    def construct(self):
        self.begin("01_problem", "Repeated decisions need completed work.")
        ticket = invoice_ticket().move_to([-4.15, 0.55, 0])
        backing = VGroup(*(
            RoundedRectangle(width=4.55, height=2.55, corner_radius=0.15,
                             color=BLUE, stroke_width=1, stroke_opacity=0.22)
            .move_to(ticket).shift(UP * (0.12 * n) + RIGHT * (0.12 * n))
            for n in [2, 1]))
        attachment = badge("Attachment: bank-debits.png", BLUE, width=3.95, size=18)
        attachment.next_to(ticket, DOWN, buff=0.2)
        self.play(FadeIn(backing), FadeIn(ticket, shift=RIGHT * 0.25), run_time=0.8)
        self.cue(0, 0.32)
        self.play(FadeIn(attachment), run_time=0.5)
        category = badge("Payments", CYAN, width=2.2).move_to([0, 0.55, 0])
        into_label = link(ticket, category, BLUE, buff=0.12)
        self.cue(0, 0.65)
        self.play(Create(into_label), FadeIn(category), run_time=0.65)
        self.send(into_label, BLUE, 0.65)
        outcome = panel("ACTUAL OUTCOME", ["Assigned to", "Payments team"], GREEN,
                        width=3.25, height=1.9, size=26).move_to([4.75, 0.55, 0])
        into_work = link(category, outcome, GREEN)
        self.cue(0, 0.83)
        self.play(Create(into_work), FadeIn(outcome), run_time=0.8)
        self.send(into_work, CYAN, 0.65)
        next_ticket = panel("NEXT REQUEST", ["Checkout failed.", "Our team cannot log in."], BLUE,
                            width=4.5, height=1.5, size=24).move_to([0, -1.85, 0])
        direct = text("Familiar", 21, CYAN).move_to([-3.5, -2.3, 0])
        needs = text("Needs investigation", 21, AMBER).move_to([3.7, -2.3, 0])
        self.cue(1)
        self.play(FadeIn(next_ticket), FadeIn(direct), FadeIn(needs), run_time=0.7)
        self.cue(1, 0.52)
        sequence = self.note("Judge  →  investigate when needed  →  act  →  record", GREEN)
        self.play(FadeIn(sequence), run_time=0.6)
        self.cue(2)
        self.play(FadeOut(sequence), run_time=0.3)
        question = self.note("How much should every application rebuild?", WHITE, size=28)
        self.play(FadeIn(question), run_time=0.6)
        self.finish()


class Scene02(FilmScene):
    def construct(self):
        self.begin("02_value", "Keep your domain logic. Reuse the machinery.")
        products = VGroup(
            panel("TICKET PRODUCT", ["Route to the", "right team"], BLUE, width=3.65, height=1.8),
            panel("NEWS PRODUCT", ["Relevant to", "my positions?"], BLUE, width=3.65, height=1.8),
            panel("REVIEW PRODUCT", ["Needs human", "attention?"], BLUE, width=3.65, height=1.8))
        products.arrange(RIGHT, buff=0.65).move_to([0, 0.9, 0])
        self.play(LaggedStart(*(FadeIn(p, shift=UP * 0.1) for p in products), lag_ratio=0.25), run_time=1.4)
        self.cue(0, 0.7)
        independent = text("Independent products · separate policies and state", 22, MUTED)
        independent.move_to([0, -0.4, 0])
        self.play(FadeIn(independent), run_time=0.55)
        self.cue(1)
        your_logic = VGroup(*(badge("Your policy + facts", BLUE, width=3.15, size=19)
                              .move_to(p.get_bottom() + DOWN * 0.4) for p in products))
        self.play(FadeOut(independent), FadeIn(your_logic), run_time=0.6)
        shared = panel("REUSABLE AGENT MACHINERY", ["Models · tools · records · deeper help"], PURPLE,
                       width=11.9, height=1.2, size=25).move_to([0, -1.95, 0])
        connectors = VGroup(*(Arrow(p.get_bottom(), shared.get_top() + RIGHT * p.get_x(),
                                    buff=0.1, color=PURPLE, stroke_width=1.6) for p in your_logic))
        self.cue(2)
        self.play(FadeIn(shared), Create(connectors), run_time=0.75)
        self.cue(2, 0.6)
        self.play(FadeIn(self.note("Spend your effort on what makes your product useful.", WHITE)), run_time=0.6)
        self.finish()


class Scene03(FilmScene):
    def construct(self):
        self.begin("03_human", "Familiar patterns can become easy to recognize.")
        automatic = model("System One", "automatic recognition", CYAN, radius=1.1).move_to([-3.6, 0.6, 0])
        deliberate = model("System Two", "deliberate effort", AMBER, radius=1.1).move_to([3.6, 0.6, 0])
        human = self.note("A human thinking analogy", MUTED)
        self.play(FadeIn(automatic), FadeIn(human), run_time=0.75)
        self.cue(0, 0.48)
        self.play(FadeIn(deliberate), run_time=0.75)
        self.cue(1)
        trainee = panel("NEW SUPPORT COLLEAGUE", ["Read the policy", "Propose a team"], BLUE,
                        width=3.7, height=1.8).move_to([-4.45, 0.55, 0])
        supervisor = panel("HUMAN SUPERVISOR", ["Check the decision", "Explain mistakes"], BLUE,
                           width=3.7, height=1.8).move_to([4.45, 0.55, 0])
        self.play(ReplacementTransform(automatic, trainee), ReplacementTransform(deliberate, supervisor),
                  FadeOut(human), run_time=0.8)
        policy = panel("PRACTICE CASE", ["Invoice dispute", "→ Payments"], AMBER,
                       width=3.1, height=1.5).move_to([0, 0.55, 0])
        learn = link(trainee, policy, BLUE, buff=0.1)
        check = link(policy, supervisor, BLUE, buff=0.1)
        self.cue(1, 0.18)
        self.play(FadeIn(policy), Create(learn), Create(check), run_time=0.8)
        self.send(learn, AMBER, 0.65)
        self.send(check, AMBER, 0.65)
        feedback_group, feedback = route([
            supervisor.get_bottom(), [4.45, -1.6, 0], [-4.45, -1.6, 0], trainee.get_bottom()
        ], BLUE)
        feedback_label = text("Reliable supervisor feedback", 24, BLUE).move_to([0, -2.1, 0])
        self.cue(1, 0.51)
        self.play(Create(feedback_group), FadeIn(feedback_label), run_time=0.6)
        for _ in range(2):
            self.send(feedback, BLUE, 0.8)
            self.play(Indicate(trainee, color=CYAN), run_time=0.45)
        self.cue(2)
        practiced = panel("FAMILIAR PATTERN", ["Invoice charge issue", "→ Payments"], CYAN,
                          width=3.7, height=1.8).move_to(trainee)
        unusual = panel("UNFAMILIAR CASE", ["Checkout + service", "Investigate first"], AMBER,
                        width=3.7, height=1.8).move_to(supervisor)
        self.play(Transform(trainee, practiced), Transform(supervisor, unusual),
                  FadeOut(policy), FadeOut(learn), FadeOut(check), FadeOut(feedback_group), run_time=0.8)
        conditions = text("Learnable patterns + repeated practice + reliable feedback", 23, BLUE)
        conditions.move_to([0, -1.7, 0])
        self.play(Transform(feedback_label, conditions), run_time=0.6)
        self.cue(2, 0.7)
        self.play(FadeIn(self.note("Recognition has limits. Keep deliberate thought available.", AMBER)), run_time=0.6)
        self.finish()


class Scene04(FilmScene):
    def construct(self):
        self.begin("04_models", "Supplied information → a typed judgment.")
        facts = panel("PREPARED TEXT + FACTS", ["T42 · May invoice", "Two settled charges", "Your routing policy"],
                      BLUE, width=3.4, height=2.25, size=23).move_to([-4.8, 0.45, 0])
        jev = model("Jev", "System One model", CYAN).move_to([-0.85, 0.45, 0])
        input_path = link(facts, jev, BLUE)
        choices = VGroup()
        for word, value in [("Payments", 0.9), ("Technical", 0.07), ("SOS", 0.03)]:
            title = text(word, 20, CYAN if value > 0.5 else MUTED)
            track = Rectangle(width=2.5, height=0.16, stroke_width=0, fill_color=GRAY, fill_opacity=0.25)
            fill_bar = Rectangle(width=2.5 * value, height=0.16, stroke_width=0, fill_color=CYAN, fill_opacity=0.9)
            fill_bar.align_to(track, LEFT)
            row = VGroup(title, VGroup(track, fill_bar)).arrange(DOWN, buff=0.12, aligned_edge=LEFT)
            choices.add(row)
        choices.arrange(DOWN, buff=0.27, aligned_edge=LEFT).move_to([3.85, 0.55, 0])
        output_path = link(jev, choices, CYAN)
        self.play(FadeIn(facts), FadeIn(jev), Create(input_path), run_time=0.9)
        self.cue(0, 0.45)
        self.send(input_path, BLUE, 0.7)
        self.play(Create(output_path), FadeIn(choices), run_time=0.8)
        selected = badge('Choice → "payments"', CYAN, width=3.55).move_to([3.85, -1.25, 0])
        illustrative = text("Illustrative distribution", 16, MUTED).move_to([3.85, -1.85, 0])
        self.cue(0, 0.75)
        self.play(FadeIn(selected), FadeIn(illustrative), run_time=0.6)
        self.cue(1)
        noul = panel("NOUL  ·  YES / NO", ["Urgent incident?", "P(yes)"], CYAN,
                     width=3.55, height=1.5, size=23).move_to([-4.8, -2.05, 0])
        noul_note = text("No separate confidence field", 16, MUTED).next_to(noul, DOWN, buff=0.12)
        self.play(FadeIn(noul), FadeIn(noul_note), run_time=0.65)
        confidence = self.note("Confidence describes concentration. It does not prove correctness.", AMBER, size=22)
        self.cue(1, 0.52)
        self.play(FadeIn(confidence), run_time=0.6)
        self.cue(2)
        top_group = VGroup(facts, jev, input_path, choices, output_path, selected, illustrative)
        self.play(top_group.animate.scale(0.86).shift(UP * 0.32),
                  FadeOut(noul), FadeOut(noul_note), FadeOut(confidence), run_time=0.7)
        deeper = panel("SYSTEM TWO  ·  LLM", ["Plan → check tools → return findings"], AMBER,
                       width=7.7, height=1.15, size=23).move_to([0, -1.85, 0])
        self.play(FadeIn(deeper), run_time=0.7)
        self.cue(2, 0.3)
        economics = text("Aim: lower routine cost and latency", 23, CYAN).move_to([0, -2.8, 0])
        self.play(FadeIn(economics), run_time=0.6)
        self.cue(2, 0.62)
        weights = self.note("Already trained · you configure and evaluate inputs + criteria", BLUE, size=21)
        self.play(Transform(economics, weights), run_time=0.7)
        self.finish()

"""Why a harness exists, the driver change, worked workflow and ownership."""
from common import *
from chapters_a import invoice_ticket


class Scene05(FilmScene):
    def construct(self):
        self.begin("05_burden", "A classifier does not run the workflow.")
        useful = panel("YOUR USEFUL LOGIC", ["Relevant facts", "A good classification"], BLUE,
                       width=4.0, height=1.8).move_to([0, 0.35, 0])
        self.play(FadeIn(useful), run_time=0.65)
        plumbing = VGroup(
            panel("EXECUTE", ["run the tool"], GREEN, width=3.1, height=1.2, size=23).move_to([-4.85, 1.25, 0]),
            panel("VERIFY", ["actual result"], GREEN, width=3.1, height=1.2, size=23).move_to([4.85, 1.25, 0]),
            panel("SESSION", ["keep records"], GRAY, width=3.1, height=1.2, size=23).move_to([-4.85, -1.15, 0]),
            panel("CONTINUE", ["next judgment"], GRAY, width=3.1, height=1.2, size=23).move_to([4.85, -1.15, 0]),
        )
        spokes = VGroup(
            Arrow(useful.get_left(), plumbing[0].get_right(), buff=0.13, color=GREEN),
            Arrow(plumbing[1].get_left(), useful.get_right(), buff=0.13, color=GREEN),
            Arrow(plumbing[2].get_right(), useful.get_left(), buff=0.13, color=GRAY),
            Arrow(useful.get_right(), plumbing[3].get_left(), buff=0.13, color=GRAY),
        )
        self.cue(0, 0.25)
        self.play(FadeIn(plumbing[0]), FadeIn(plumbing[1]), Create(spokes[0]), Create(spokes[1]), run_time=0.8)
        self.cue(0, 0.63)
        self.play(FadeIn(plumbing[3]), Create(spokes[3]), run_time=0.65)
        self.cue(1)
        help_scope = panel("HELPER COORDINATION", ["goal · tool scope · findings return"], PURPLE,
                           width=7.8, height=1.15, size=23).move_to([0, -2.3, 0])
        helper_link = Arrow(useful.get_bottom(), help_scope.get_top(), color=PURPLE, buff=0.15)
        self.play(FadeIn(help_scope), Create(helper_link), run_time=0.7)
        self.cue(1, 0.7)
        self.play(FadeIn(plumbing[2]), Create(spokes[2]), run_time=0.65)
        self.cue(2)
        outline = RoundedRectangle(width=13.15, height=4.7, corner_radius=0.2,
                                   color=PURPLE, stroke_width=1.5).move_to([0, -0.3, 0])
        self.play(Create(outline), run_time=0.8)
        self.cue(2, 0.45)
        self.play(FadeIn(self.note("Product-specific meaning. Reusable agent machinery.", PURPLE, y=-3.25)), run_time=0.65)
        self.finish()


class Scene06(FilmScene):
    def construct(self):
        self.begin("06_foundation", "Pi supplies the harness. Turbo changes the driver.")
        goal = panel("USER GOAL", ["Handle this ticket"], BLUE, width=3.35, height=1.5).move_to([-4.8, 0.8, 0])
        driver = model("LLM", "ordinary Pi driver", AMBER).move_to([-0.65, 0.8, 0])
        tools = panel("PI TOOLS", ["call → real result"], GREEN, width=3.6, height=1.5).move_to([4.6, 0.8, 0])
        from_goal = link(goal, driver, BLUE)
        to_tools = link(driver, tools, GREEN)
        self.play(FadeIn(goal), Create(from_goal), FadeIn(driver), run_time=0.9)
        self.cue(0, 0.4)
        self.play(Create(to_tools), FadeIn(tools), run_time=0.7)
        self.send(to_tools, AMBER, 0.7)
        back_group, back = route([
            tools.get_bottom(), [4.6, -0.8, 0], [-0.65, -0.8, 0], driver.get_bottom()
        ], GREEN)
        self.cue(0, 0.66)
        self.play(Create(back_group), run_time=0.6)
        self.send(back, GREEN, 0.8)
        final_response = self.note("Goal → tool → result → another turn → response", GREEN)
        self.play(FadeIn(final_response), run_time=0.55)
        self.cue(1)
        self.play(FadeOut(back_group), FadeOut(final_response), run_time=0.4)
        classifier = panel("NATIVE CLASSIFIER ACCESS", ["Jev → typed result"], CYAN,
                           width=4.1, height=1.2, size=25).move_to([-3.3, -1.85, 0])
        classify_group, classify_path = route([
            driver.get_bottom(), [-0.65, -0.95, 0], [-3.3, -0.95, 0], classifier.get_top()
        ], CYAN)
        self.play(FadeIn(classifier), Create(classify_group), run_time=0.8)
        self.send(classify_path, CYAN, 0.75)
        auxiliary = text("Available to extensions and model-callable tools", 21, CYAN).move_to([2.8, -1.5, 0])
        self.cue(1, 0.45)
        self.play(FadeIn(auxiliary), run_time=0.6)
        self.cue(1, 0.75)
        self.play(FadeIn(self.note("Classification is available. The LLM still drives this loop.", AMBER)), run_time=0.6)
        self.cue(2)
        leftovers = [m for m in self.mobjects if m not in [goal, driver, tools, from_goal, to_tools, self.header]
                     and getattr(m, "get_y", lambda: 4)() < -0.7]
        self.play(*(FadeOut(m) for m in leftovers), run_time=0.5)
        new_driver = model("System One", "ongoing driver", CYAN).move_to(driver)
        self.play(Transform(driver, new_driver), run_time=0.85)
        turbo = RoundedRectangle(width=13, height=2.9, corner_radius=0.2,
                                 color=PURPLE, stroke_width=1.6).move_to([0, 0.75, 0])
        turbo_name = text("Turbo coordinates typed decisions", 22, PURPLE).move_to([0, 2.02, 0])
        self.play(Create(turbo), FadeIn(turbo_name), run_time=0.7)
        helper = panel("OPTIONAL SYSTEM TWO", ["scoped subtask"], AMBER,
                       width=3.6, height=1.15, size=24).move_to([-0.65, -1.8, 0])
        help_group, help_path = route([
            driver.get_right(), [1.2, 0.8, 0], [1.2, -0.9, 0], [0.25, -1.225, 0]
        ], AMBER)
        self.cue(2, 0.28)
        self.play(FadeIn(helper), Create(help_group), run_time=0.65)
        self.send(help_path, AMBER, 0.7)
        path_label = text("turbo/auto → provider → native classify", 21, PURPLE).move_to([0, -2.7, 0])
        self.cue(2, 0.5)
        self.play(FadeIn(path_label), run_time=0.6)
        shared = self.note("Keep your other Pi extensions + connected MCP tools", GREEN, y=-3.25, size=22)
        self.cue(2, 0.78)
        self.play(FadeIn(shared), run_time=0.6)
        self.finish()

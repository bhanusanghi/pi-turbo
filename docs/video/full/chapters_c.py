"""Late chapters: composition, authored seams, scoped help, and the payoff.

These are silent visual scenes. The production pipeline adds measured narration.
All displayed code is schematic pseudocode, not executable sample code.
"""
from common import *


class Scene09(FilmScene):
    def construct(self):
        self.begin("09_connect", "Connect the capabilities you already use")
        classifier = panel("SYSTEM ONE CONFIG", ["Jev classifier", "your integration"], CYAN,
                           width=4.3, height=1.55, size=25).move_to([-2.6, 0.95, 0])
        helper = panel("OPTIONAL SYSTEM TWO", ["selected LLM", "enabled + tool ceiling"], AMBER,
                       width=4.3, height=1.55, size=25).move_to([2.6, 0.95, 0])
        configured = self.note("Configure the models. Enable deeper help when useful.", BLUE)
        self.cue(0)
        self.play(FadeIn(classifier, shift=UP * 0.15), run_time=0.65)
        self.cue(0, 0.45)
        self.play(FadeIn(helper, shift=UP * 0.15), FadeIn(configured), run_time=0.65)

        self.cue(1)
        self.play(classifier.animate.scale(0.72).move_to([-3.35, 1.5, 0]),
                  helper.animate.scale(0.72).move_to([3.35, 1.5, 0]),
                  FadeOut(configured), run_time=0.65)
        native = badge("your Pi tool", GREEN, width=3.1).move_to([-4.1, 0.05, 0])
        extension = badge("another Pi extension", GREEN, width=3.6).move_to([0, 0.05, 0])
        mcp = badge("connected MCP", GREEN, width=3.1).move_to([4.1, 0.05, 0])
        rack = RoundedRectangle(width=12, height=1.25, corner_radius=0.15,
                                color=GREEN, fill_color=PANEL, fill_opacity=1).move_to([0, -1.25, 0])
        rack_label = text("PI REGISTERED TOOLS", 16, GREEN).move_to([0, -0.88, 0])
        tools = VGroup(
            badge("assign_ticket", GREEN, width=3.1, size=23).move_to([-3.7, -1.45, 0]),
            badge("read_order", GREEN, width=3.1, size=23).move_to([0, -1.45, 0]),
            badge("read_service_status", GREEN, width=3.5, size=21).move_to([3.65, -1.45, 0]),
        )
        source_paths = VGroup(*(Arrow(s.get_bottom(), rack.get_top() + RIGHT * s.get_x(),
                                     color=GREEN, buff=0.12, stroke_width=2)
                               for s in [native, extension, mcp]))
        self.play(FadeIn(native), FadeIn(extension), FadeIn(mcp), run_time=0.65)
        self.play(FadeIn(rack), FadeIn(rack_label), Create(source_paths), run_time=0.65)
        self.play(LaggedStart(*(FadeIn(t) for t in tools), lag_ratio=0.18), run_time=0.8)
        self.cue(1, 0.75)
        self.play(Indicate(tools[0], color=GREEN, scale_factor=1.06), run_time=0.65)

        self.cue(2)
        scope = RoundedRectangle(width=7.15, height=0.83, corner_radius=0.12,
                                 color=AMBER, stroke_width=2).move_to([1.82, -1.45, 0])
        scope_label = text("helper's granted subset", 23, AMBER).move_to([1.82, -2.28, 0])
        permission = self.note("Your bindings + explicit grants. Pi execution hooks still apply.", GREEN)
        self.play(Create(scope), FadeIn(scope_label), FadeIn(permission), run_time=0.75)
        grant_line, grant_path = route([
            helper.get_bottom(), [3.35, 0.45, 0], [5.85, 0.45, 0], [5.85, -1.1, 0],
            [5.35, -1.1, 0],
        ], AMBER)
        self.play(Create(grant_line), run_time=0.65)
        self.send(grant_path, AMBER, run_time=0.8)
        lifecycle = self.note("Pi lifecycle: register → session_start → cleanup", GREEN,
                              y=-2.78, size=18)
        self.play(FadeIn(lifecycle), run_time=0.5)
        self.finish()


class Scene10(FilmScene):
    def construct(self):
        self.begin("10_functions", "Three small seams you supply")
        prepare = code_card("1 · Prepare the next judgment", [
            "prepareTurn(ctx):",
            "  s = myTicketState(ctx)",
            "  if currentReceiptConfirms(s): return myFinal(s)",
            "  q = questionsFor(s, ctx.capabilities)",
            "  return {request: q,",
            "          resolve: r => mapDecision(s, r)}",
        ], width=11.1, height=3.65, size=24).move_to([0, 0.0, 0])
        caption = self.note("Current request + policy + matching receipt / evidence", BLUE, y=-2.35)
        self.cue(0)
        self.play(FadeIn(prepare, shift=UP * 0.12), FadeIn(caption), run_time=0.7)
        self.cue(0, 0.67)
        self.play(Indicate(prepare[2][2], color=GREEN, scale_factor=1.02), run_time=0.7)

        question = code_card("2 · Define the judgment", [
            "questionsFor(state, caps):",
            "  return {state, questions: {next: {",
            "    type: \"choice\",",
            "    instructions: \"Choose the next step\",",
            "    criteria: myRoutingCriteria(caps)",
            "  }}}",
        ], width=11.1, height=3.65, size=24).move_to(prepare)
        choices = self.note("payments · technical · SOS · investigate (if enabled)", CYAN, y=-2.35)
        self.cue(1)
        self.play(ReplacementTransform(prepare, question), ReplacementTransform(caption, choices), run_time=0.75)
        self.cue(1, 0.68)
        self.play(Indicate(question[2][4], color=BLUE, scale_factor=1.02), run_time=0.7)

        binding = code_card("3 · Bind the answer to a real action", [
            "mapDecision(state, result):",
            "  next = validNext(result.answers.next)",
            "  if next == \"payments\":",
            "    return {kind: \"tool\", name: \"assign_ticket\",",
            "            args: {ticketId: state.ticket.id,",
            "                   team: \"payments\"}}",
        ], width=11.1, height=3.65, size=24).move_to(question)
        exact = self.note("This ticket ID. This team. The registered tool executes.", GREEN, y=-2.35)
        self.cue(2)
        self.play(ReplacementTransform(question, binding), ReplacementTransform(choices, exact), run_time=0.75)
        self.cue(2, 0.65)
        self.play(Indicate(binding[2][3], color=GREEN, scale_factor=1.02), run_time=0.65)

        registration = code_card("Register the preparation seam", [
            "registerSystem1(pi, {id: \"tickets\", revision: \"1\",",
            "                    tools: myPiTools, prepareTurn})",
        ], owner="YOUR INTEGRATION", color=PURPLE, width=11.1, height=1.95, size=23)
        registration.move_to([0, 0.75, 0])
        self.cue(3)
        self.play(ReplacementTransform(binding, registration), FadeOut(exact), run_time=0.75)
        receipt = panel("PI", ["real tool receipt"], GREEN, width=3.25, height=1.25, size=24).move_to([-4.1, -1.4, 0])
        preparation = panel("YOUR FUNCTION", ["prepareTurn again"], BLUE, width=3.25, height=1.25, size=23).move_to([0, -1.4, 0])
        done = panel("YOUR FINAL CONDITION", ["completed"], GREEN, width=3.25, height=1.25, size=24).move_to([4.1, -1.4, 0])
        first = link(receipt, preparation, GREEN)
        second = link(preparation, done, BLUE)
        self.play(FadeIn(receipt), FadeIn(preparation), FadeIn(done), Create(first), Create(second), run_time=0.8)
        self.send(first, GREEN, run_time=0.7)
        self.send(second, BLUE, run_time=0.7)
        self.play(FadeIn(self.note("You supply meaning and bindings. Pi supplies execution.", PURPLE)), run_time=0.6)
        self.finish()


class Scene11(FilmScene):
    def construct(self):
        self.begin("11_help_state", "Help returns facts. You choose what stays.")
        consultation = code_card("Return a scoped subtask", [
            "return {kind: \"consult\", request: {",
            "  goal: \"Payment issue or outage?\",",
            "  inputs: {ticket: state.ticket},",
            "  doneWhen: \"Supported findings + uncertainties\",",
            "  tools: myExactReadGrants(state.ticket)",
            "}}",
        ], width=11.2, height=3.65, size=24).move_to([0, 0.1, 0])
        grants = self.note("Read grants are bound to this ticket's order and service.", AMBER, y=-2.35)
        self.cue(0)
        self.play(FadeIn(consultation), FadeIn(grants), run_time=0.7)
        self.cue(0, 0.50)
        helper = model("System Two", "native Pi helper", AMBER, radius=0.85).move_to([-4.1, 0.1, 0])
        order = panel("PERMITTED READ", ["read_order", "this ticket's order ID"], GREEN,
                      width=5, height=1.25, size=23).move_to([1.1, 0.95, 0])
        service = panel("PERMITTED READ", ["read_service_status", "this ticket's service ID"], GREEN,
                        width=5, height=1.25, size=23).move_to([1.1, -0.9, 0])
        self.play(FadeOut(consultation), FadeOut(grants), FadeIn(helper), FadeIn(order), FadeIn(service), run_time=0.7)
        first, first_path = route([helper.get_right(), [-2.65, 0.1, 0], [-2.65, 0.95, 0], order.get_left()], AMBER)
        second, second_path = route([helper.get_right(), [-2.65, 0.1, 0], [-2.65, -0.9, 0], service.get_left()], AMBER)
        self.play(Create(first), run_time=0.5)
        self.send(first_path, AMBER, run_time=0.65)
        order_outcome = badge("actual order result", GREEN, width=2.35, size=19).move_to([4.8, 0.95, 0])
        self.play(FadeIn(order_outcome), run_time=0.45)
        self.play(Create(second), run_time=0.5)
        self.send(second_path, AMBER, run_time=0.65)
        service_outcome = badge("outage evidence", GREEN, width=2.35, size=19).move_to([4.8, -0.9, 0])
        self.play(FadeIn(service_outcome), run_time=0.45)
        helper_note = self.note("A bounded subtask can contain several native tool steps.", AMBER)
        self.play(FadeIn(helper_note), run_time=0.5)

        self.cue(1)
        investigation = VGroup(helper, order, service, first, second, order_outcome, service_outcome, helper_note)
        before = panel("AUTHOR-PREPARED INPUT", ["ticket T42 + policy", "May invoice + attachment text"], BLUE,
                       width=5.0, height=1.7, size=24).move_to([-3.3, 0.55, 0])
        after = panel("NEXT AUTHOR-PREPARED INPUT", ["ticket T42 + policy", "+ selected order / outage evidence"], BLUE,
                      width=5.0, height=1.7, size=23).move_to([3.3, 0.55, 0])
        evidence = badge("findings + real results", AMBER, width=4.5, size=23).move_to([0, -1.6, 0])
        update = link(before, after, BLUE)
        returned, returned_path = route([evidence.get_top(), [0, -0.65, 0], [3.3, -0.65, 0], after.get_bottom()], AMBER)
        self.play(FadeOut(investigation), FadeIn(before), FadeIn(after), Create(update), FadeIn(evidence), run_time=0.75)
        self.play(Create(returned), run_time=0.55)
        self.send(returned_path, AMBER, run_time=0.75)
        input_note = self.note("prepareTurn chooses what the next judgment actually sees.", BLUE)
        self.play(FadeIn(input_note), run_time=0.5)

        self.cue(2)
        state_input = VGroup(before, after, update, evidence, returned, input_note)
        pi_store = panel("PI HISTORY", ["messages", "tool outcomes"], GREEN, width=3.8, height=2.0, size=25).move_to([-4.15, 0.1, 0])
        turbo_store = panel("TURBO CONTROL", ["attempt / phase", "execution records"], PURPLE, width=3.8, height=2.0, size=25).move_to([0, 0.1, 0])
        author_store = panel("YOUR BUSINESS STATE", ["facts / receipts", "selected model context"], BLUE, width=3.8, height=2.0, size=25).move_to([4.15, 0.1, 0])
        state_note = self.note("V1: your code manages business state and model context.", BLUE, y=-2.0)
        durability = self.note("Recorded state ≠ automatic crash continuation", MUTED, y=-2.8, size=22)
        self.play(FadeOut(state_input), FadeIn(pi_store), run_time=0.6)
        self.play(FadeIn(turbo_store), FadeIn(author_store), FadeIn(state_note), run_time=0.65)
        self.cue(2, 0.7)
        self.play(FadeIn(durability), run_time=0.5)
        self.finish()


class Scene12(FilmScene):
    def construct(self):
        self.begin("12_close", "Bring your logic. Reuse the foundation.")
        logic = panel("YOUR APPLICATION", ["rules + relevant facts", "tool bindings"], BLUE,
                      width=3.65, height=1.8, size=25).move_to([-4.15, 0.55, 0])
        turbo = panel("TURBO", ["judgment-driven flow", "optional deeper help"], PURPLE,
                      width=3.65, height=1.8, size=24).move_to([0, 0.55, 0])
        pi = panel("PI", ["execution + records", "existing capabilities"], GREEN,
                   width=3.65, height=1.8, size=24).move_to([4.15, 0.55, 0])
        first = link(logic, turbo, BLUE)
        second = link(turbo, pi, PURPLE)
        self.cue(0)
        self.play(FadeIn(logic), run_time=0.55)
        self.play(Create(first), FadeIn(turbo), run_time=0.65)
        self.play(Create(second), FadeIn(pi), run_time=0.65)
        extensions = badge("other Pi extensions", GREEN, width=3.5, size=22).move_to([2.2, -1.4, 0])
        mcp = badge("connected MCP tools", GREEN, width=3.5, size=22).move_to([4.4, -2.15, 0])
        extension_link = Arrow(extensions.get_top(), pi.get_bottom() + LEFT * 0.9, color=GREEN, buff=0.13, stroke_width=2)
        mcp_link = Arrow(mcp.get_top(), pi.get_bottom() + RIGHT * 0.65, color=GREEN, buff=0.13, stroke_width=2)
        self.cue(0, 0.75)
        self.play(FadeIn(extensions), FadeIn(mcp), Create(extension_link), Create(mcp_link), run_time=0.7)
        self.send(first, BLUE, run_time=0.65)
        self.send(second, PURPLE, run_time=0.65)

        self.cue(1)
        news = panel("SEPARATE NEWS AGENT", ["positions + RSS evidence", "your alert bindings"], BLUE,
                     width=3.65, height=1.8, size=23).move_to(logic)
        self.play(ReplacementTransform(logic, news), run_time=0.65)
        self.play(FadeIn(self.note("The same seams. A separate product and its own state.", BLUE, y=-2.75)), run_time=0.55)
        self.cue(1, 0.35)
        self.send(first, BLUE, run_time=0.65)
        self.send(second, PURPLE, run_time=0.65)
        self.cue(1, 0.65)
        takeaway = badge("Start bounded. Evaluate real cases.", WHITE, width=8.3, height=0.65, size=27).move_to([0, -1.65, 0])
        self.play(FadeOut(extensions), FadeOut(mcp), FadeOut(extension_link), FadeOut(mcp_link), FadeIn(takeaway), run_time=0.65)
        self.finish()

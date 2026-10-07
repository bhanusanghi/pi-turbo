"""Refresh the offline storyboard, timing table and narration from scenes.json.

Run: python3 docs/video/build_storyboard.py
Keeps the renderer and manually authored production sections intact.
"""
import json
from pathlib import Path

root = Path(__file__).resolve().parent
scenes = json.loads((root / 'scenes.json').read_text())
assert scenes and scenes[0]['start'] == 0
assert all(left['end'] == right['start'] for left, right in zip(scenes, scenes[1:]))
assert all(scene['end'] > scene['start'] for scene in scenes)
assert all(not scene['cards'] for scene in scenes if scene['start'] < 330), 'Code belongs at the end.'
assert all(len(card['code'].splitlines()) <= 7 for scene in scenes for card in scene['cards'])

html_path = root / 'storyboard.html'
html = html_path.read_text()
start = html.index('const scenes = ') + len('const scenes = ')
end = html.index(';\nconst colors=', start)
html_path.write_text(html[:start] + json.dumps(scenes, indent=2, ensure_ascii=False) + html[end:])

def fmt(seconds):
    return '%d:%02d' % divmod(seconds, 60)

timeline = '| Time | Scene | Reveal |\n| --- | --- | --- |\n'
script = 'Each early scene is visual only. Pseudocode appears in scenes 10–11, after the architecture.\n'
for i, scene in enumerate(scenes, 1):
    timeline += '| %s–%s | %s | %s |\n' % (
        fmt(scene['start']), fmt(scene['end']), scene['chapter'], scene['subtitle'])
    script += '\n### %02d. %s (%s–%s)\n\n**Narration**\n\n%s\n\n**Visual beats**\n\n%s\n\n**Producer note**\n\n%s\n' % (
        i, scene['title'], fmt(scene['start']), fmt(scene['end']), scene['narration'], scene['caption'], scene['note'])
    for card in scene['cards']:
        script += '\n**%s — pseudocode**\n\n```text\n%s\n```\n' % (card['title'], card['code'])

plan_path = root / 'video-plan.md'
plan = plan_path.read_text()
for name, content in [('timeline', timeline), ('script', script)]:
    opening, closing = '<!-- %s:start -->' % name, '<!-- %s:end -->' % name
    start = plan.index(opening) + len(opening)
    end = plan.index(closing, start)
    plan = plan[:start] + '\n\n' + content + '\n' + plan[end:]
plan_path.write_text(plan)
print('Updated %d scenes, %s total; first pseudocode at 5:30.' % (len(scenes), fmt(scenes[-1]['end'])))

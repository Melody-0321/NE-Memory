txt = open(r'd:\SillyTavern\xm\ne-memory\dist\index.js', 'r', encoding='utf-8').read()

# Find the HTML template for narrative_secondary_api_status
idx = txt.find('narrative_secondary_api_status')
print(f'Total occurrences of "narrative_secondary_api_status": {txt.count("narrative_secondary_api_status")}')

# Find all positions
positions = []
pos = 0
while True:
    pos = txt.find('narrative_secondary_api_status', pos)
    if pos == -1:
        break
    positions.append(pos)
    pos += 1

for i, p in enumerate(positions):
    context = txt[max(0,p-150):min(len(txt),p+250)]
    print(f'\n--- Occurrence {i+1} at {p} ---')
    print(context)

# Check for the HTML template (should include inline styles)
idx_html = txt.find('id=\\"narrative_secondary_api_status\\"')
if idx_html >= 0:
    print(f'\nHTML template at {idx_html}:')
    print(txt[max(0,idx_html-100):idx_html+300])

import re
with open(r'd:\SillyTavern\xm\ne-memory\dist\index.js', 'r', encoding='utf-8') as f:
    txt = f.read()

# Find className assignments near ne-api-dot context
idx = txt.find('api_dot')
if idx >= 0:
    # Search for className in the nearby region (within 2000 chars)
    region = txt[max(0,idx-500):min(len(txt),idx+2000)]
    # Find all className assignments
    for m in re.finditer(r'\.className\s*=\s*[^;]+;?', region):
        context_start = max(0, m.start()-60)
        context_end = min(len(region), m.end()+60)
        print(f'  [{m.start()}]: {region[context_start:context_end]}')
    print('---')

# Also check for the #4caf50 and #888 hardcoded colors
for color in ['4caf50', '#888']:
    if color in txt:
        idx = txt.find(color)
        print(f'{color} found at {idx}: ...{txt[max(0,idx-80):idx+80]}...')
    else:
        print(f'{color}: NOT FOUND in build')

# Check for var(--ne-success) usage  
count = txt.count('ne-success')
print(f'"ne-success" occurrences: {count}')

count2 = txt.count('ne-muted')
print(f'"ne-muted" occurrences: {count2}')

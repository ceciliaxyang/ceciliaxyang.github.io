import json,re,sys,difflib,html as H
s=open(sys.argv[1]).read()
data=json.loads(re.search(r'id="cc-data">(.*?)</script>',s,re.S).group(1))
state=json.loads(re.search(r'id="cc-state">(.*?)</script>',s,re.S).group(1))
cards={p['key']:p for p in data['patterns']}
def lines(h):
    h=re.sub(r'<span class="tile[^"]*"[^>]*>.*?</span>','[tile]',h)  # tiles (svg placeholders are empty)
    h=re.sub(r'<div class="foot-shape".*?</div>','[tiles picture]',h,flags=re.S)
    h=re.sub(r'</(p|li|h3|div|button)>','\n',h); h=re.sub(r'<span class="(lbl|sub)">','\n',h)
    h=re.sub(r'<[^>]+>','',h); h=H.unescape(h).replace('\xa0',' ')
    return [l.strip() for l in h.split('\n') if l.strip()]
print('saved version', state['version'], state['savedAt'])
for k,e in state['edits'].items():
    p=cards[k]; print('\n=====',k,'|',p['name'])
    if e.get('notes'): print('NOTES:',e['notes'])
    if e.get('html'):
        for l in difflib.unified_diff(lines(p['card']),lines(e['html']),lineterm='',n=0):
            if not l.startswith(('---','+++','@@')): print(l)

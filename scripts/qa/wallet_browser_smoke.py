"""Browser smoke test against a local build. ALL backend requests use fixtures, never live accounts.
Build with REACT_APP_SUPABASE_URL=https://wallet-preview.supabase.co and a dummy anon key.
Uses set_content (no navigation or backend network access); requires Python playwright and Chromium.
"""
import base64, json, os, time
from pathlib import Path
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright, expect

OUT = Path(os.environ.get('WALLET_QA_OUTPUT', 'qa-output/browser'))
OUT.mkdir(parents=True, exist_ok=True)
HOST = 'https://wallet-preview.supabase.co'
AUTH_KEY = 'sb-wallet-preview-auth-token'
A = '11111111-1111-4111-8111-111111111111'
B = '22222222-2222-4222-8222-222222222222'
CUTOFF = '2026-09-07T15:00:00+00:00'

def session(uid):
    claims = {'sub': uid, 'role':'authenticated','aud':'authenticated','exp': int(time.time()) + 3600}
    enc = lambda x: base64.urlsafe_b64encode(json.dumps(x).encode()).decode().rstrip('=')
    user = {'id': uid, 'email': 'qa@example.invalid','role':'authenticated','aud':'authenticated','email_confirmed_at':CUTOFF,'user_metadata':{'display_name':'QA Creator'}, 'created_at':CUTOFF}
    return {'access_token': enc({'alg':'HS256','typ':'JWT'})+'.'+enc(claims)+'.fixture', 'refresh_token':'fixture-only','expires_at':claims['exp'],'expires_in':3600,'token_type':'bearer','user':user}

with sync_playwright() as pw:
    browser = pw.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH','/usr/bin/chromium'), headless=True, args=['--no-sandbox','--no-proxy-server'])
    context = browser.new_context(viewport={'width':1440,'height':1060}, accept_downloads=True)

    calls = []; errors = []; balances={A:123450001,B:7000000}; reward_state='visit_required'; fail_overview=False
    def owner(req):
        try:
            token = req.headers.get('authorization','').split()[-1].split('.')[1]
            return json.loads(base64.urlsafe_b64decode(token+'='*(-len(token)%4)))['sub']
        except Exception: return A
    items=[{'id':f'aaaaaaaa-aaaa-4aaa-8aaa-{i:012d}', 'created_at':f'2026-09-07T14:{59-i:02d}:00+00:00', 'entry_type':'sale','amount_fav':'1000001','held_change_fav':'0','order_id':None,'status':'posted','label':f'QA service earnings {i+1}','description':'=HYPERLINK("fixture only")' if i==0 else 'QA fixture transaction','seller_fee_fav':'30000'} for i in range(31)]
    def reward():
        result={'reason':reward_state,'eligible':reward_state=='eligible','claimed':reward_state=='already_claimed','current_streak':1,'reward_date':'2026-09-07','amount_micro_fav':'50000','offer_id':'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'}
        if result['claimed']:result['receipt']={'transaction_id':'cccccccc-cccc-4ccc-8ccc-cccccccccccc','amount_micro_fav':'50000'}
        return result
    def route(handler, req):
        global reward_state, fail_overview
        if not req.url.startswith(HOST):
            if urlparse(req.url).hostname in ('127.0.0.1','localhost'):return handler.continue_()
            return handler.abort()
        uid=owner(req);path=urlparse(req.url).path;name=path.split('/')[-1]
        args=req.post_data_json if req.method=='POST' and req.post_data else {}
        calls.append({'name':name,'args':args,'owner':uid})
        headers={'access-control-allow-origin':'*','access-control-allow-headers':'*','content-type':'application/json'}
        if req.method=='OPTIONS':return handler.fulfill(status=200,headers=headers,body='{}')
        value=[]
        if '/auth/v1/user' in path:value=session(uid)['user']
        elif '/auth/' in path:value={}
        elif name=='profiles':value={'id':uid,'display_name':'QA Creator','preferred_language':'en','bio':''} if 'object+json' in req.headers.get('accept','') else [{'id':uid,'display_name':'QA Creator','preferred_language':'en','bio':''}]
        elif name=='get_my_username_status':value=[{'username':'qa_creator','username_chosen':True}]
        elif name=='get_my_wallet_overview':
            if fail_overview:
                fail_overview=False
                return handler.fulfill(status=503,headers=headers,body=json.dumps({'message':'QA simulated wallet outage','code':'503'}))
            value={'server_time':CUTOFF,'wallet':{'available_fav':str(balances[uid]),'held_fav':'3000000','updated_at':CUTOFF},'sources':{'earned_fav':'100000000' if uid==A else '0','reward_fav':str(balances[uid]-(100000000 if uid==A else 0)),'purchased_fav':'0','legacy_fav':'0'},'held_orders':[]}
        elif name=='get_my_account_eligibility':value={'birth_date_required':False,'is_adult':True,'identity_status':'unverified','crypto_consent_required':True,'crypto_eligible':False}
        elif name=='get_my_daily_reward_status':value=reward()
        elif name=='record_my_reward_visit':reward_state='eligible';value=reward()
        elif name=='claim_my_daily_reward':
            if reward_state!='already_claimed':balances[uid]+=50000
            reward_state='already_claimed';value=reward()
        elif name=='list_my_wallet_activity':
            index=30 if args.get('p_cursor') else 0;rows=items[index:index+30] if uid==A else []
            value={'items':rows,'cutoff':CUTOFF,'next_cursor':{'id':rows[-1]['id'],'created_at':rows[-1]['created_at']} if uid==A and index==0 else None}
        elif name=='get_my_wallet_transaction':value=next((x for x in items if x['id']==args['p_transaction_id']),None)
        elif name=='submit_my_wallet_support_request':value={'id':'support-fixture'}
        elif name=='begin_my_wallet_statement':value={'id':'dddddddd-dddd-4ddd-8ddd-dddddddddddd','cutoff':CUTOFF,'row_count':len(items),'balances':{'opening_available_fav':None},'amount_unit':'micro-FAV'}
        elif name=='get_my_wallet_statement_page':value={'items':items,'cutoff':CUTOFF,'next_cursor':None}
        elif name=='get_crypto_chain_status':value={'chain_id':84532,'token_address':None,'minter_address':None,'unlock_enabled':False,'initial_cap_micro_fav':10000000000000}
        elif name=='get_my_fav_balance_breakdown':value={'available_fav':balances[uid],'held_fav':3000000,'earned_fav':100000000,'reward_fav':balances[uid]-100000000,'purchased_fav':0,'legacy_fav':0,'crypto_eligible_fav':0,'crypto_maturing_fav':100000000,'pending_crypto_unlock_fav':0,'crypto_unlock_maturity_hours':120,'crypto_unlock_fee_bps':250}
        elif name=='crypto_wallets':value=None
        elif name=='get_my_social_graph':value={'friends':[],'blocked':[],'incoming_requests':[],'outgoing_requests':[]}
        elif name in ('set_my_presence','get_my_preferred_language'):value=None
        return handler.fulfill(status=200,headers=headers,body=json.dumps(value))
    # All test content is our own local build. No blocked network URLs are visited.
    from types import SimpleNamespace
    class FixtureResponse:
        def fulfill(self, status=200, headers=None, body='{}'):
            return {'status':status,'headers':headers or {},'body':body}
        def abort(self):
            raise RuntimeError('Unexpected non-fixture fetch')
    def fixture_fetch(_source, payload):
        request=SimpleNamespace(url=payload['url'],method=payload['method'],headers=payload['headers'],post_data=payload.get('body'),post_data_json=json.loads(payload['body']) if payload.get('body') else {})
        return route(FixtureResponse(),request)
    context.expose_binding('__walletFixtureFetch',fixture_fetch)
    page=context.new_page();page.on('pageerror',lambda error: errors.append(str(error)))
    page.set_content('<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div></body></html>')
    page.evaluate("""() => {
      const values=new Map(); const storage={getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,String(v)),removeItem:k=>values.delete(k),clear:()=>values.clear()};
      Object.defineProperty(window,'localStorage',{value:storage,configurable:true});
      Object.defineProperty(window,'sessionStorage',{value:storage,configurable:true});
      const channels=new Map();
      window.BroadcastChannel=class extends EventTarget { constructor(name){super();this.name=name;if(!channels.has(name))channels.set(name,new Set());channels.get(name).add(this);} postMessage(data){for(const c of channels.get(this.name)){if(c!==this)setTimeout(()=>c.dispatchEvent(new MessageEvent('message',{data})),0);}} close(){channels.get(this.name).delete(this);} };
      window.fetch=async (url,init={})=>{const result=await window.__walletFixtureFetch({url:String(url),method:init.method||'GET',headers:Object.fromEntries(new Headers(init.headers||{})),body:init.body||null});return new Response(result.body,{status:result.status,headers:result.headers});};
      window.WebSocket=class { static OPEN=1;static CONNECTING=0;static CLOSED=3;readyState=0;send(){}close(){this.readyState=3;}addEventListener(){}removeEventListener(){} };
      window.location.hash='wallet';
    }""")
    page.evaluate('data=>localStorage.setItem(data.key,JSON.stringify(data.session))', {'key':AUTH_KEY,'session':session(A)})
    build=Path(__file__).resolve().parents[2]/'build'
    for css in (build/'static/css').glob('*.css'):page.add_style_tag(content=css.read_text())
    main=next((build/'static/js').glob('main.*.js'));page.add_script_tag(content=main.read_text())
    expect(page.get_by_role('heading',name='Know where your FAV goes.')).to_be_visible(timeout=15000)
    expect(page.get_by_text('123.450001 FAV',exact=True)).to_be_visible()
    assert not any(c['name'].startswith('claim') for c in calls),'A reward was claimed on mount'
    page.add_style_tag(content='body::after{content:"AUTOMATED QA · FIXTURE DATA";position:fixed;bottom:0;left:0;right:0;text-align:center;background:#101521;color:#fff;font:11px sans-serif;z-index:999999;padding:6px}')
    page.screenshot(path=str(OUT/'wallet-desktop.png'),full_page=False)
    page.get_by_role('button',name='Check today’s reward').click()
    page.get_by_role('button',name='Claim 0.05 FAV').click()
    expect(page.get_by_text('123.500001 FAV',exact=True)).to_be_visible()
    page.get_by_role('button',name='Load more transactions').click()
    expect(page.get_by_text('QA service earnings 31',exact=True)).to_be_visible()
    page.get_by_role('button',name='QA service earnings 1 ',exact=False).first.click()
    expect(page.get_by_role('heading',name='Transaction details')).to_be_focused()
    page.get_by_label('Report a problem with this transaction').fill('QA fixture: verify this transaction receipt.')
    page.get_by_role('button',name='Send to support').click()
    expect(page.get_by_text('Your support request was received. No balance or order was changed.')).to_be_visible()
    for file_type in ('CSV','JSON'):
        with page.expect_download() as info: page.get_by_role('button',name='Export '+file_type).click()
        download=info.value;target=OUT/('fixture-statement.'+file_type.lower());download.save_as(target)
        text=target.read_text(encoding='utf-8-sig')
        if file_type=='JSON':assert len(json.loads(text)['items'])==31
        else:assert "'=HYPERLINK" in text and '1.000001' in text
    fail_overview=True;page.get_by_role('button',name='Refresh wallet').click()
    expect(page.get_by_role('alert').filter(has_text='QA simulated wallet outage')).to_be_visible()
    page.get_by_role('button',name='Refresh wallet').click()
    expect(page.get_by_text('123.500001 FAV',exact=True)).to_be_visible()
    page.locator('.wallet-crypto-details>summary').click()
    expect(page.get_by_text('Testnet token deployment pending',exact=True)).to_be_visible()
    expect(page.get_by_role('button',name='Connect & verify testnet wallet')).to_be_disabled()
    expect(page.get_by_role('button',name='Queue crypto unlock')).to_have_count(0)
    page.set_viewport_size({'width':390,'height':844});page.evaluate('window.scrollTo(0,0)')
    expect(page.get_by_role('button',name='Open navigation',exact=True)).to_be_visible()
    page.get_by_role('button',name='Open navigation',exact=True).click()
    expect(page.get_by_role('navigation',name='Main navigation')).to_be_visible()
    page.screenshot(path=str(OUT/'wallet-mobile-menu.png'),full_page=False)
    page.keyboard.press('Escape')
    expect(page.get_by_role('button',name='Open navigation',exact=True)).to_be_focused()
    assert page.evaluate('document.documentElement.scrollWidth <= window.innerWidth'), 'Horizontal mobile overflow'
    page.screenshot(path=str(OUT/'wallet-mobile.png'),full_page=False)
    page.evaluate('''data => { localStorage.setItem(data.key, JSON.stringify(data.session)); const channel=new BroadcastChannel(data.key); channel.postMessage({event:'SIGNED_IN',session:data.session}); setTimeout(()=>channel.close(),100); }''',{'key':AUTH_KEY,'session':session(B)})
    expect(page.locator('.wallet-stat-primary').get_by_text('7 FAV',exact=True)).to_be_visible(timeout=15000)
    expect(page.get_by_text('123.500001 FAV',exact=True)).to_have_count(0)
    expect(page.get_by_text('QA service earnings 1',exact=True)).to_have_count(0)
    assert not errors,errors
    summary={'result':'passed','backend':'in-memory fixture fetch; no backend network access','rendering':'local production bundle rendered with set_content; fixture Storage/BroadcastChannel adapters','viewport_sizes':['1440x1060','390x844'],'checks':['initial exact balance','no automatic reward','manual offer and claim','activity pagination','details focus','support','CSV and JSON complete snapshot','failure and retry','crypto locked','mobile drawer and Escape','no mobile overflow','account switch clears old data'],'javascript_errors':errors,'claim_calls':sum(c['name']=='claim_my_daily_reward' for c in calls)}
    (OUT/'browser-results.json').write_text(json.dumps(summary,indent=2))
    print(json.dumps(summary,indent=2));browser.close()

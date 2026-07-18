import { DEFAULT_AGGREGATOR, MODEL_ALIASES, MODEL_CATALOG, MODEL_PRESETS } from "./workers-ai/models";

/** 反查默认 aggregator 的短名（供前端默认选中）。 */
const DEFAULT_AGGREGATOR_SHORT = Object.entries(MODEL_ALIASES).find(([, id]) => id === DEFAULT_AGGREGATOR)?.[0] ?? "gpt-oss-120b";

/**
 * 渲染模型组合配置页 HTML。
 * 单页应用：勾选 proposer + aggregator → 实时生成组合字符串 / curl / MCP JSON。
 */
export function renderConfigPage(origin: string): string {
  const data = {
    models: MODEL_CATALOG,
    presets: MODEL_PRESETS,
    origin,
    defaultAggregator: DEFAULT_AGGREGATOR_SHORT,
  };
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>moe 模型组合配置器</title>
<style>
  :root { color-scheme: dark; --bg:#0f1115; --panel:#171a21; --border:#262b36; --accent:#4f8cff; --text:#e6e9f0; --dim:#8b94a8; --ok:#3dd68c; --warn:#f5a623; }
  * { box-sizing: border-box; }
  body { margin:0; background:var(--bg); color:var(--text); font:14px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"PingFang SC","Microsoft YaHei",sans-serif; padding:24px; }
  h1 { font-size:20px; margin:0 0 4px; }
  h2 { font-size:15px; margin:24px 0 10px; color:var(--dim); font-weight:600; letter-spacing:.3px; }
  p.lead { color:var(--dim); margin:0 0 18px; max-width:880px; }
  code { background:#0b0d12; padding:1px 5px; border-radius:4px; font-size:12.5px; }
  .presets { display:flex; gap:8px; flex-wrap:wrap; margin-bottom:8px; }
  .presets button { background:var(--panel); color:var(--text); border:1px solid var(--border); border-radius:8px; padding:8px 14px; cursor:pointer; font-size:13px; transition:.15s; }
  .presets button:hover { border-color:var(--accent); color:var(--accent); }
  .presets .desc { font-size:11px; color:var(--dim); margin-left:4px; }
  .grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(260px,1fr)); gap:10px; }
  .card { background:var(--panel); border:1px solid var(--border); border-radius:10px; padding:12px 14px; cursor:pointer; transition:.12s; position:relative; }
  .card:hover { border-color:#3a4252; }
  .card.checked { border-color:var(--accent); background:#1a2233; }
  .card input { position:absolute; opacity:0; }
  .card .name { font-weight:600; font-size:14px; }
  .card .meta { color:var(--dim); font-size:11.5px; margin-top:4px; display:flex; gap:6px; flex-wrap:wrap; }
  .tag { background:#0b0d12; border:1px solid var(--border); border-radius:4px; padding:0 6px; font-size:10.5px; }
  .tag.r { color:var(--ok); border-color:#1f4a36; }
  .tag.v { color:#b48bff; border-color:#2a2150; }
  .tag.f { color:var(--accent); border-color:#1d2f4d; }
  .price { color:var(--warn); font-size:11px; }
  .agg .card.checked { border-color:var(--ok); background:#13231c; }
  .out { background:#0b0d12; border:1px solid var(--border); border-radius:8px; padding:14px; margin-top:8px; }
  .out .combo { font-family:ui-monospace,SFMono-Regular,Menlo,monospace; font-size:13px; word-break:break-all; color:var(--accent); }
  .out .empty { color:var(--dim); font-style:italic; }
  pre { background:#0b0d12; border:1px solid var(--border); border-radius:8px; padding:12px; overflow:auto; font-size:12px; line-height:1.5; margin:8px 0; }
  .copy { background:var(--panel); color:var(--text); border:1px solid var(--border); border-radius:6px; padding:5px 12px; cursor:pointer; font-size:12px; }
  .copy:hover { border-color:var(--accent); color:var(--accent); }
  .copy.ok { border-color:var(--ok); color:var(--ok); }
  .row { display:flex; align-items:center; gap:8px; }
  .hint { color:var(--dim); font-size:11.5px; margin-top:6px; }
</style>
</head>
<body>
  <h1>moe 模型组合配置器</h1>
  <p class="lead">勾选 Proposer（多选）和 Aggregator（单选），实时生成模型组合字符串。复制下方的 curl 或 MCP JSON 即可调用 <code>/v1/messages</code> 或 <code>moa_reason</code> 工具。格式 <code>proposer1/proposer2/.../aggregator</code>（最后一个是 aggregator）。</p>

  <div class="presets" id="presets"></div>

  <h2>Proposer（多选）</h2>
  <div class="grid" id="proposers"></div>

  <h2>Aggregator（单选）</h2>
  <div class="grid agg" id="aggregators"></div>

  <h2>生成的组合</h2>
  <div class="out"><div class="combo" id="combo"><span class="empty">在上方勾选模型后这里会显示组合字符串</span></div></div>
  <div class="hint">留空使用服务端默认组合（<code>qwen2.5-coder-32b / glm-4.7-flash / mistral-small-3.1-24b / gpt-oss-120b</code>）。</div>

  <h2>Anthropic API 调用</h2>
  <pre id="curl"></pre>
  <div class="row"><button class="copy" data-target="curl">复制 curl</button></div>

  <h2>MCP 调用 JSON</h2>
  <pre id="mcp"></pre>
  <div class="row"><button class="copy" data-target="mcp">复制 MCP JSON</button></div>

<script>
var DATA = ${JSON.stringify(data)};
var selP = []; // selected proposers (shortName, 有序)
var selA = DATA.defaultAggregator; // selected aggregator shortName

function tagHtml(t){
  if (t==='reasoning') return '<span class="tag r">reasoning</span>';
  if (t==='vision') return '<span class="tag v">vision</span>';
  if (t==='functionCalling'||t==='agentic') return '<span class="tag f">agentic</span>';
  return '<span class="tag">'+t+'</span>';
}
function metaHtml(m){
  var parts=[];
  if(m.contextWindow) parts.push(Math.round(m.contextWindow/1000)+'k ctx');
  if(m.priceInPerM!=null && m.priceOutPerM!=null) parts.push('<span class="price">$'+m.priceInPerM+'/'+m.priceOutPerM+' per M</span>');
  return parts.join(' · ');
}
function cardHtml(m, kind){
  var id = kind+'-'+m.shortName;
  var inputType = kind==='p' ? 'checkbox' : 'radio';
  return '<label class="card" data-name="'+m.shortName+'" data-kind="'+kind+'">'
    + '<input type="'+inputType+'" name="aggregator" id="'+id+'" data-name="'+m.shortName+'" data-kind="'+kind+'">'
    + '<div class="name">'+m.shortName+'</div>'
    + '<div class="meta">'+m.tags.map(tagHtml).join('')+' · '+metaHtml(m)+'</div>'
    + '</label>';
}
function render(){
  var p='', a='';
  DATA.models.forEach(function(m){
    p += cardHtml(m,'p');
    a += cardHtml(m,'a');
  });
  document.getElementById('proposers').innerHTML=p;
  document.getElementById('aggregators').innerHTML=a;
  // 默认选中 aggregator
  selectAgg(DATA.defaultAggregator);
  // 绑定事件
  document.querySelectorAll('.card').forEach(function(el){
    el.addEventListener('click', function(){
      var name=el.getAttribute('data-name'), kind=el.getAttribute('data-kind');
      if(kind==='p'){
        var i=selP.indexOf(name);
        if(i>=0){ selP.splice(i,1); } else { selP.push(name); }
      } else {
        selectAgg(name);
      }
      refresh();
    });
  });
  refresh();
}
function selectAgg(name){ selA=name; }
function combo(){
  if(selP.length===0) return '';
  return selP.join('/')+'/'+selA;
}
function refresh(){
  // 卡片选中态
  document.querySelectorAll('.card').forEach(function(el){
    var n=el.getAttribute('data-name'), k=el.getAttribute('data-kind');
    if(k==='p'){ el.classList.toggle('checked', selP.indexOf(n)>=0); }
    else { el.classList.toggle('checked', n===selA); }
  });
  var c=combo();
  var comboEl=document.getElementById('combo');
  if(c){ comboEl.className='combo'; comboEl.textContent=c; }
  else { comboEl.className='combo'; comboEl.innerHTML='<span class="empty">在上方勾选模型后这里会显示组合字符串</span>'; }
  // curl
  var task='你的问题';
  var body=JSON.stringify({model:'moa-sonnet',max_tokens:2048,messages:[{role:'user',content:task}]});
  var url=DATA.origin+'/v1/messages'+(c?('?models='+c):'');
  var curl='curl -X POST '+url+' \\\n'
    + '  -H "x-api-key: $MOA_AUTH_TOKEN" \\\n'
    + '  -H "content-type: application/json" \\\n'
    + '  -H "anthropic-version: 2023-06-01" \\\n'
    + "  -d '"+body+"'";
  document.getElementById('curl').textContent=curl;
  // mcp
  var mcpObj={jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'moa_reason',arguments:{task:task}}};
  if(c) mcpObj.params.arguments.models=c;
  document.getElementById('mcp').textContent=JSON.stringify(mcpObj,null,2);
}
function applyPreset(key){
  var pre=DATA.presets[key];
  if(!pre) return;
  var parts=pre.models.split('/');
  selP=parts.slice(0,-1);
  selA=parts[parts.length-1];
  refresh();
}
function clearAll(){
  selP=[]; selA=DATA.defaultAggregator; refresh();
}
function renderPresets(){
  var host=document.getElementById('presets');
  var html='';
  Object.keys(DATA.presets).forEach(function(k){
    var p=DATA.presets[k];
    html+='<button data-preset="'+k+'">'+p.label+'<span class="desc">'+p.description+'</span></button>';
  });
  html+='<button id="clear-btn">清空</button>';
  host.innerHTML=html;
  host.querySelectorAll('button[data-preset]').forEach(function(b){
    b.addEventListener('click', function(){ applyPreset(b.getAttribute('data-preset')); });
  });
  document.getElementById('clear-btn').addEventListener('click', clearAll);
}
function bindCopy(){
  document.querySelectorAll('.copy').forEach(function(b){
    b.addEventListener('click', function(){
      var id=b.getAttribute('data-target');
      var text=document.getElementById(id).textContent;
      navigator.clipboard.writeText(text).then(function(){
        var old=b.textContent; b.textContent='已复制 ✓'; b.classList.add('ok');
        setTimeout(function(){ b.textContent=old; b.classList.remove('ok'); },1200);
      });
    });
  });
}
renderPresets(); render(); bindCopy();
</script>
</body>
</html>`;
}

/** 配置页 HTTP 响应。 */
export function configPageResponse(request: Request): Response {
  const origin = new URL(request.url).origin;
  return new Response(renderConfigPage(origin), {
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
  });
}

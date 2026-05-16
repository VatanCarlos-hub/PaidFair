import { createClient } from 'https://esm.sh/genlayer-js@latest';
import { studionet } from 'https://esm.sh/genlayer-js@latest/chains';

const CONTRACT_ADDRESS = '0x94582C426DCf506796546520255F33d1b0367244';
const GENLAYER_CHAIN_ID = '0xf22f';

const $ = (id) => document.getElementById(id);

let walletAddress = null;
let client = null;
let analysisRunning = false;
let lastTxHash = null;

/* ───────── Reveal on scroll ───────── */
const io = new IntersectionObserver((entries)=>{
  entries.forEach(e=>{ if(e.isIntersecting){ e.target.classList.add('in'); io.unobserve(e.target);} });
},{threshold:0.12});
document.querySelectorAll('.reveal').forEach(el=>io.observe(el));

/* ───────── Counters ───────── */
(function runCounters(){
  document.querySelectorAll('.counter').forEach(el=>{
    if(el.dataset.done)return;
    const target=parseFloat(el.dataset.target);
    const suffix=el.dataset.suffix||'';
    const dur=1600;const start=performance.now();
    function tick(now){
      const t=Math.min(1,(now-start)/dur);
      const eased=1-Math.pow(1-t,3);
      const v=Math.round(target*eased);
      el.textContent=v.toLocaleString()+suffix;
      if(t<1)requestAnimationFrame(tick);else el.dataset.done=1;
    }
    requestAnimationFrame(tick);
  });
})();

/* ───────── Smooth scroll ───────── */
function scrollTo(el){
  if(!el) return;
  const headerH = document.querySelector('header.nav')?.offsetHeight || 0;
  const top = el.getBoundingClientRect().top + window.scrollY - headerH - 8;
  window.scrollTo({top, behavior:'smooth'});
}

$('cta-begin').addEventListener('click', ()=> scrollTo($('form-section')));
$('cta-how').addEventListener('click', ()=> scrollTo($('how')));

/* ───────── Salary input formatting ───────── */
const salaryInput = $('f-salary');
salaryInput.addEventListener('input', ()=>{
  const raw = salaryInput.value.replace(/[^\d]/g,'');
  salaryInput.value = raw ? Number(raw).toLocaleString() : '';
});

/* ───────── Form gating + alert helpers ───────── */
const runBtn = $('run-btn');
function setNeedsWallet(needs){
  runBtn.classList.toggle('needs-wallet', needs);
}
function showAlert(msg){
  const a = $('form-alert');
  a.innerHTML = `<span class="ico">⚠</span>${msg}`;
  a.classList.add('show');
}
function clearAlert(){ $('form-alert').classList.remove('show'); }

/* ───────── Wallet connect ───────── */
const walletBtn = $('walletBtn');
async function connectWallet(){
  if(!window.ethereum){
    showAlert('MetaMask not found. Install MetaMask to connect your wallet.');
    scrollTo($('form-section'));
    return false;
  }
  walletBtn.classList.add('busy');
  try{
    const accounts = await window.ethereum.request({ method:'eth_requestAccounts' });
    walletAddress = accounts[0];
    try{
      await window.ethereum.request({
        method:'wallet_switchEthereumChain',
        params:[{ chainId: GENLAYER_CHAIN_ID }]
      });
    }catch(e){
      if(e.code === 4902){
        await window.ethereum.request({
          method:'wallet_addEthereumChain',
          params:[{
            chainId: GENLAYER_CHAIN_ID,
            chainName:'GenLayer Studio',
            rpcUrls:['https://studio.genlayer.com/api'],
            nativeCurrency:{ name:'GEN', symbol:'GEN', decimals:18 }
          }]
        });
      }else{ throw e; }
    }
    client = createClient({ chain: studionet, account: walletAddress });
    walletBtn.classList.add('connected');
    $('walletAddr').textContent = walletAddress.slice(0,6)+'…'+walletAddress.slice(-4);
    setNeedsWallet(false);
    clearAlert();
    return true;
  }catch(err){
    showAlert('Wallet connection failed: '+(err?.message||'Unknown error'));
    return false;
  }finally{
    walletBtn.classList.remove('busy');
  }
}

function disconnectWallet(){
  walletAddress = null;
  client = null;
  walletBtn.classList.remove('connected');
  setNeedsWallet(true);
}

walletBtn.addEventListener('click', async ()=>{
  if(walletAddress){ disconnectWallet(); return; }
  await connectWallet();
});
setNeedsWallet(true);

/* ───────── Submit + flow ───────── */
const form = $('valuation');
let timerHandle = null, progressHandle = null, streamHandles = [];

form.addEventListener('submit', async (e)=>{
  e.preventDefault();
  if(analysisRunning) return;
  clearAlert();

  const title  = $('f-title').value.trim();
  const region = $('f-region').value.trim();
  const years  = $('f-years').value.trim();
  const salary = salaryInput.value.replace(/[^\d]/g,'');

  if(!title || !region || !years){
    showAlert('Please fill in Job Title, Work Region and Years of Experience.');
    return;
  }

  if(!walletAddress){
    const ok = await connectWallet();
    if(!ok) return;
  }

  analysisRunning = true;
  const loadingSection = $('loading-section');
  loadingSection.classList.add('unlocked');
  setTimeout(()=> scrollTo(loadingSection), 100);

  resetLoadingUI();
  startTimer();

  let pctTarget = 0;
  function setPct(p, stage, title, copy){
    pctTarget = Math.max(pctTarget, p);
    $('progress-bar').style.width = pctTarget+'%';
    $('progress-pct').textContent = pctTarget+'%';
    if(stage) $('progress-stage').textContent = stage;
    if(title) $('loading-title').innerHTML = title;
    if(copy)  $('loading-copy').textContent = copy;
  }

  setPct(2,'Awaiting wallet signature…');
  animateStreamLine(0);

  let parsed = null;
  try{
    setPct(6,'Awaiting wallet signature…',
      'Awaiting your <em>signature</em>',
      'MetaMask will ask you to sign the transaction. Once submitted, validators pull from labour-market sources, regional cost-of-living curves, and live posting data.');

    const txHash = await client.writeContract({
      address: CONTRACT_ADDRESS,
      functionName: 'analyze_salary',
      args: [title, region, years, salary || ''],
      value: 0
    });
    lastTxHash = txHash;

    setPct(15,'Transaction submitted · awaiting consensus',
      'Validators <em>deliberating</em>',
      'Multiple AI validators are independently processing your query on GenLayer. Awaiting network consensus — approximately 2–3 minutes.');
    $('tx-row').classList.add('show');
    $('tx-hash').textContent = txHash;
    animateStreamLine(1);

    pollProgress();

    await client.waitForTransactionReceipt({
      hash: txHash,
      status:'FINALIZED',
      retries: 60,
      interval: 5000
    });
    animateStreamLine(2);
    animateStreamLine(3);

    setPct(94,'Consensus reached · retrieving result',
      'Consensus <em>reached</em>',
      'Validators have signed. Retrieving the verified result from chain.');
    const raw = await client.readContract({
      address: CONTRACT_ADDRESS,
      functionName: 'get_result',
      args: [walletAddress]
    });
    if(!raw) throw new Error('No result returned from the network. Please try again.');
    parsed = JSON.parse(raw);
    if(parsed.error) throw new Error('The contract encountered an error. Please try again.');

    setPct(100,'Verdict signed.',
      'Verdict <em>signed</em>',
      'The verdict has been published on chain. Open your full report below.');
    animateStreamLine(4);
  }catch(err){
    stopTimer(); stopProgress(); stopStream();
    analysisRunning = false;
    showAlert(err?.message || 'Analysis failed. Please try again.');
    loadingSection.classList.remove('unlocked');
    scrollTo($('form-section'));
    return;
  }

  stopTimer(); stopProgress();
  populateResults(parsed, {title, region, years, salary});

  // Unlock results immediately — modal is just a preview
  const resultsSection = $('results-section');
  resultsSection.classList.add('unlocked');
  $('empty-section')?.style && ($('empty-section').style.display = 'none');

  setTimeout(openModal, 350);
  analysisRunning = false;
});

/* ───────── Loading UI helpers ───────── */
function resetLoadingUI(){
  $('progress-bar').style.width = '0%';
  $('progress-pct').textContent = '0%';
  $('progress-stage').textContent = 'Awaiting wallet signature…';
  $('loading-timer').textContent = '00:00';
  $('tx-row').classList.remove('show');
  $('tx-hash').textContent = '—';
  document.querySelectorAll('#vstream .line').forEach(l=>{
    l.classList.remove('in');
    const tail = l.querySelector('span:last-child');
    tail.textContent = '…';
    tail.className = 'pending';
  });
  streamHandles.forEach(clearTimeout); streamHandles = [];
}
function startTimer(){
  const t0 = performance.now();
  stopTimer();
  timerHandle = setInterval(()=>{
    const s = Math.floor((performance.now()-t0)/1000);
    const mm = String(Math.floor(s/60)).padStart(2,'0');
    const ss = String(s%60).padStart(2,'0');
    $('loading-timer').textContent = `${mm}:${ss}`;
  }, 250);
}
function stopTimer(){ if(timerHandle){clearInterval(timerHandle); timerHandle=null;} }

function pollProgress(){
  stopProgress();
  const start = parseInt($('progress-bar').style.width)||15;
  const target = 88;
  const dur = 150000;
  const t0 = performance.now();
  progressHandle = setInterval(()=>{
    const t = Math.min(1, (performance.now()-t0)/dur);
    const eased = 1-Math.pow(1-t, 2);
    const v = Math.round(start + (target-start)*eased);
    if(v > (parseInt($('progress-bar').style.width)||0)){
      $('progress-bar').style.width = v+'%';
      $('progress-pct').textContent = v+'%';
    }
  }, 600);
}
function stopProgress(){ if(progressHandle){clearInterval(progressHandle); progressHandle=null;} }

function animateStreamLine(i){
  const lines = document.querySelectorAll('#vstream .line');
  if(!lines[i]) return;
  lines[i].classList.add('in');
  const tail = lines[i].querySelector('span:last-child');
  const h = setTimeout(()=>{
    tail.textContent = i===lines.length-1 ? 'SIGNED' : 'OK';
    tail.className = 'ok';
  }, 900);
  streamHandles.push(h);
}
function stopStream(){ streamHandles.forEach(clearTimeout); streamHandles = []; }

/* ───────── Modal ───────── */
function openModal(){
  $('modal').classList.add('open');
  document.body.style.overflow = 'hidden';
}
function closeModal(){
  $('modal').classList.remove('open');
  document.body.style.overflow = '';
}
$('modal-close').addEventListener('click', closeModal);
$('modal-dismiss').addEventListener('click', closeModal);
$('modal-view').addEventListener('click', ()=>{
  closeModal();
  setTimeout(()=> scrollTo($('results-section')), 100);
});
$('modal').addEventListener('click', (e)=>{ if(e.target.id==='modal') closeModal(); });

/* ───────── Re-run ───────── */
function rerun(){
  $('results-section').classList.remove('unlocked');
  $('loading-section').classList.remove('unlocked');
  $('empty-section')?.style && ($('empty-section').style.display = '');
  scrollTo($('form-section'));
}
$('rerun-btn').addEventListener('click', rerun);
$('rerun-btn-2').addEventListener('click', rerun);

$('verify-btn').addEventListener('click', ()=>{
  if(lastTxHash){
    navigator.clipboard?.writeText(lastTxHash);
    const btn = $('verify-btn');
    const orig = btn.innerHTML;
    btn.innerHTML = 'Tx hash copied ✓';
    setTimeout(()=> btn.innerHTML = orig, 1800);
  }
}, false);

/* ───────── Populate results from contract data ───────── */
function fmtUSD(n){
  if(n===null||n===undefined||isNaN(Number(n))) return '—';
  return Number(n).toLocaleString('en-US', {maximumFractionDigits:0});
}
function fmtUSDShort(n){
  if(!n) return '—';
  return Math.round(Number(n)/1000)+'k';
}

function populateResults(d, input){
  const assessment = (d.assessment || 'FAIR').toUpperCase();
  const isUnder = assessment === 'UNDERPAID';
  const isOver  = assessment === 'WELLPAID';

  const lowUSD  = d.salary_low_usd;
  const midUSD  = d.salary_mid_usd;
  const highUSD = d.salary_high_usd;
  const estimate = d.your_estimate_usd ?? midUSD;
  const floorUSD = d.negotiation_floor_usd;
  const curCode = d.currency_code || 'USD';
  const userSalary = parseInt(input.salary, 10) || 0;

  $('r-title').firstChild.textContent = (d.job_title || input.title || '—');
  $('r-region').textContent = (d.work_region || input.region || '—');
  $('r-years').textContent = (input.years || '0') + ' years';
  $('r-currency').textContent = curCode;

  const verdictLabel =
    isUnder ? 'Underpaid · below market' :
    isOver  ? 'Well paid · above market' :
              'Fair · market range';
  const verdictWord =
    isUnder ? 'underpaid' :
    isOver  ? 'well paid' :
              'fairly paid';

  $('r-badge').className = 'verdict-badge ' + (isUnder?'under':isOver?'fair':'');
  $('r-badge').textContent = verdictLabel;
  $('r-verdict-word').textContent = verdictWord;
  $('r-verdict-sub').textContent = d.verdict || '';

  $('r-current').textContent = fmtUSD(userSalary || estimate);
  $('r-scale-low').textContent  = '$'+fmtUSDShort(lowUSD);
  $('r-scale-mid').textContent  = '$'+fmtUSDShort(midUSD)+' median';
  $('r-scale-high').textContent = '$'+fmtUSDShort(highUSD);

  const lo = Number(lowUSD)||0, hi = Number(highUSD)||1;
  const spread = hi - lo || 1;
  const rangeLeft  = ((Number(midUSD) - lo) * 0.6 / spread) * 100;
  const rangeRight = 100 - (((Number(midUSD) - lo) * 1.4 / spread) * 100);
  $('r-range').style.left  = Math.max(2, Math.min(60, rangeLeft))+'%';
  $('r-range').style.right = Math.max(2, Math.min(60, rangeRight))+'%';
  const sal = userSalary || Number(estimate) || Number(midUSD) || 0;
  const youPct = Math.max(2, Math.min(98, ((sal - lo) / spread) * 100));
  $('r-you').style.left = youPct+'%';

  const ranges = document.querySelectorAll('.range-card');
  ranges[0].querySelector('[data-low]').textContent  = fmtUSD(lowUSD);
  ranges[1].querySelector('[data-mid]').textContent  = fmtUSD(midUSD);
  ranges[2].querySelector('[data-high]').textContent = fmtUSD(highUSD);
  ranges.forEach(c=>{ c.classList.remove('active'); c.querySelector('.activeTag')?.remove(); });
  const yrs = parseInt(input.years,10) || 0;
  const idx = yrs <= 2 ? 0 : yrs <= 6 ? 1 : 2;
  ranges[idx].classList.add('active');
  const tag = document.createElement('span');
  tag.className='activeTag';
  tag.textContent='▲ Your bracket';
  ranges[idx].appendChild(tag);

  const tipsEl = $('tips-list');
  tipsEl.innerHTML = '';
  const tips = Array.isArray(d.interview_tips) ? d.interview_tips : [];
  if(tips.length === 0){
    tipsEl.innerHTML = `
      <div class="tip">
        <div class="tip-num">01</div>
        <div>
          <h4>Anchor on the senior median, not your current salary.</h4>
          <p>Open with the upper-mid range, citing benchmarks rather than personal need. Anchoring high re-frames every counter as a discount.</p>
        </div>
      </div>`;
  } else {
    tips.forEach((tip, i)=>{
      const num = String(i+1).padStart(2,'0');
      const el = document.createElement('div');
      el.className = 'tip';
      el.innerHTML = `
        <div class="tip-num">${num}</div>
        <div>
          <h4>${escapeHtml(tip.title || '')}</h4>
          <p>${escapeHtml(tip.text || '')}</p>
        </div>`;
      tipsEl.appendChild(el);
    });
  }

  $('r-floor').textContent = fmtUSD(floorUSD);
  $('floor-cur').textContent = curCode+' · annual gross';
  if(userSalary>0 && floorUSD){
    const diff = ((Number(floorUSD)-userSalary)/userSalary*100);
    $('floor-note').textContent = diff>0
      ? `↳ ${diff.toFixed(1)}% above your current package`
      : `↳ ${Math.abs(diff).toFixed(1)}% below your current — you're already past floor`;
  } else {
    $('floor-note').textContent = `↳ Validator-derived minimum for ${input.region || 'your region'}`;
  }

  if(lastTxHash){
    $('r-tx').textContent = lastTxHash.length>22
      ? lastTxHash.slice(0,12)+'…'+lastTxHash.slice(-8)
      : lastTxHash;
  }

  const modalBadge = $('modal-badge');
  modalBadge.className = 'modal-badge ' + (isUnder?'under':isOver?'fair':'');
  modalBadge.textContent = verdictLabel;
  $('modal-word').textContent = verdictWord;
  $('modal-current').textContent = userSalary ? fmtUSD(userSalary) : '—';
  $('modal-median').textContent  = fmtUSD(midUSD);

  document.querySelectorAll('#results-section .reveal').forEach(el=>{
    el.classList.remove('in');
    requestAnimationFrame(()=>requestAnimationFrame(()=>el.classList.add('in')));
  });
}

function escapeHtml(s){ return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

/* Auto-detect already-authorized wallet */
(async ()=>{
  if(!window.ethereum) return;
  try{
    const accounts = await window.ethereum.request({ method:'eth_accounts' });
    if(accounts && accounts[0]){
      walletAddress = accounts[0];
      try{ client = createClient({ chain: studionet, account: walletAddress }); }catch(_){}
      walletBtn.classList.add('connected');
      $('walletAddr').textContent = walletAddress.slice(0,6)+'…'+walletAddress.slice(-4);
      setNeedsWallet(false);
    }
  }catch(_){}
})();

/* React to MetaMask account switches / disconnects */
if(window.ethereum){
  window.ethereum.on('accountsChanged', (accounts)=>{
    if(!accounts || accounts.length === 0){
      disconnectWallet();
    } else {
      walletAddress = accounts[0];
      try{ client = createClient({ chain: studionet, account: walletAddress }); }catch(_){}
      walletBtn.classList.add('connected');
      $('walletAddr').textContent = walletAddress.slice(0,6)+'…'+walletAddress.slice(-4);
      setNeedsWallet(false);
    }
  });
}

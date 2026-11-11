/* Painel de Serviços — checklist (PC e celular). Serviço → subtópico → item. Login Google → API Apps Script. */
(function () {
  'use strict';
  var CFG = window.PS_CFG || {};
  var DEMO = /[?&]demo\b/.test(location.search);
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var st = { d: null, filtro: 'Em andamento', busca: '', view: 'servicos', ocupado: false, edServ: null, edTar: null };

  /* ---------- utilitários ---------- */
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var brl = function (n) { return n == null || n === '' ? '' : Number(n).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }); };
  var dataBR = function (iso) { return iso ? iso.slice(8, 10) + '/' + iso.slice(5, 7) + '/' + iso.slice(0, 4) : ''; };
  var dataCurta = function (iso) { return iso ? iso.slice(8, 10) + '/' + iso.slice(5, 7) : ''; };
  var num = function (s) { s = String(s || '').replace(/[^\d.,]/g, ''); if (!s) return null; if (s.indexOf(',') >= 0) s = s.replace(/\./g, '').replace(',', '.'); else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, ''); var n = Number(s); return isNaN(n) || n <= 0 ? null : n; };
  var norm = function (s) { return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''); };
  var aberto = function (s) { return s.situacao !== 'Concluído' && s.situacao !== 'Cancelado'; };
  var diasAte = function (iso) { if (!iso) return null; var h = new Date(); h.setHours(0, 0, 0, 0); return Math.round((new Date(iso + 'T00:00:00') - h) / 864e5); };
  var tom = function (d) { return d == null ? '' : d < 0 ? 'bad' : d <= 7 ? 'warn' : ''; };
  var diasTxt = function (d) { return d < 0 ? (-d) + (d === -1 ? ' dia de atraso' : ' dias de atraso') : d === 0 ? 'vence hoje' : d === 1 ? 'vence amanhã' : 'em ' + d + ' dias'; };
  function toast(msg, erro) {
    var t = $('#toast'); t.textContent = msg; t.className = 'toast on' + (erro ? ' err' : '');
    clearTimeout(toast.h); toast.h = setTimeout(function () { t.className = 'toast'; }, erro ? 6000 : 3500);
  }

  /* ---------- login Google ---------- */
  var TK = 'ps-token', CACHE = 'ps-dados', cliente = null;
  function lerToken() { try { var t = JSON.parse(localStorage.getItem(TK) || 'null'); return t && t.exp > Date.now() + 60000 ? t : null; } catch (e) { return null; } }
  function contaSalva() { try { return (JSON.parse(localStorage.getItem(TK) || '{}') || {}).email || ''; } catch (e) { return ''; } }
  function entrar() {
    if (!window.google || !google.accounts) { toast('Carregando o login do Google. Tente de novo em instantes.', true); return; }
    if (!cliente) cliente = google.accounts.oauth2.initTokenClient({
      client_id: CFG.clientId, scope: 'openid email', hint: contaSalva() || undefined,
      callback: function (r) {
        if (!r || !r.access_token) return toast('Login cancelado.', true);
        localStorage.setItem(TK, JSON.stringify({ token: r.access_token, exp: Date.now() + (Number(r.expires_in) || 3600) * 1000, email: contaSalva() }));
        $('#login').hidden = true;
        fetch('https://openidconnect.googleapis.com/v1/userinfo', { headers: { Authorization: 'Bearer ' + r.access_token } })
          .then(function (x) { return x.json(); }).then(function (u) { var t = lerToken(); if (t && u.email) { t.email = u.email; localStorage.setItem(TK, JSON.stringify(t)); conta(); } }).catch(function () {});
        carregar();
      },
      error_callback: function (e) { toast('Login não concluído (' + (e && e.type || 'erro') + ').', true); }
    });
    cliente.requestAccessToken({ prompt: contaSalva() ? '' : 'select_account' });
  }
  function sair() { localStorage.removeItem(TK); localStorage.removeItem(CACHE); location.reload(); }
  function conta() {
    var c = $('#conta'), t = lerToken(); c.hidden = DEMO;
    c.textContent = t ? (t.email || 'conta Google') + ' · sair' : 'Entrar para atualizar';
    c.title = t ? 'Sair desta conta' : 'Seu login venceu. Toque para entrar de novo.';
  }
  function telaLogin(msg) { $('#login-msg').textContent = msg || 'Entre com sua conta Google para ver e editar os serviços.'; $('#login').hidden = false; }

  /* ---------- API ---------- */
  function api(body) {
    if (DEMO) return demoApi(body);
    var t = lerToken();
    if (!t) { conta(); if (!st.d) telaLogin(); else toast('Seu login venceu. Toque em "Entrar para atualizar" e os dados voltam.', true); return Promise.reject(new Error('sem login')); }
    ocupado(true);
    return fetch(CFG.api, { method: 'POST', body: JSON.stringify(Object.assign({}, body, { accessToken: t.token })) })
      .then(function (r) { return r.json(); })
      .then(function (v) {
        if (v && v.error === 'UNAUTHORIZED') {
          localStorage.removeItem(TK); conta();
          telaLogin('A conta ' + (t.email || 'escolhida') + ' não tem acesso. Entre com a conta liberada para a planilha.');
          throw new Error('sem acesso');
        }
        if (!v || !v.ok) throw new Error(v && v.error || 'A planilha respondeu de forma inesperada.');
        if (v.servicos) { st.d = v; try { localStorage.setItem(CACHE, JSON.stringify(v)); } catch (e) {} render(); }
        return v;
      })
      .catch(function (e) {
        if (!/sem login|sem acesso/.test(e.message)) toast(e.message === 'Failed to fetch' ? 'Não consegui falar com a planilha. Confira a internet e toque em Atualizar.' : '✖ ' + e.message, true);
        render(); throw e;
      })
      .finally(function () { ocupado(false); });
  }
  function ocupado(on) {
    st.ocupado = on; $('#btn-sync').classList.toggle('spin', on);
    $('#sync-state').textContent = on ? 'Sincronizando…' : st.d ? 'Atualizado às ' + new Date(st.d.geradoEm).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '';
  }
  function carregar() { return api({ rota: 'dados' }).catch(function () {}); }
  function acao(body, itemId) {
    if (itemId) $$('[data-item="' + itemId + '"]').forEach(function (el) { el.classList.add('pend'); });
    return api(Object.assign({ rota: 'acao' }, body)).then(function (v) {
      if (v.msg) toast(v.msg, /^✖/.test(v.msg));
      if (v.precisaValor) pedirValor(v.precisaValor);
      return v;
    });
  }

  /* ---------- modelo ---------- */
  function servico(id) { return st.d.servicos.find(function (s) { return s.id === id; }); }
  function tarefa(id) { return st.d.tarefas.find(function (t) { return t.id === id; }); }
  function subtopicos(sid) { var ts = st.d.tarefas.filter(function (t) { return t.servico === sid; }); return ts.filter(function (t) { return !t.pai || !ts.some(function (p) { return p.id === t.pai; }); }); }
  function itens(tid) { return st.d.tarefas.filter(function (t) { return t.pai === tid; }); }
  // prazo que manda: o do serviço ou o de um subtópico/item aberto que vence antes
  function prazoEfetivo(s) {
    var best = s.dias != null ? { dias: s.dias, prazo: s.prazo, origem: '' } : null;
    if (!aberto(s)) return best;
    st.d.tarefas.forEach(function (t) {
      var d = t.dias != null ? t.dias : diasAte(t.prazo);
      if (t.servico === s.id && t.situacao !== 'Concluída' && d != null && (!best || d < best.dias)) best = { dias: d, prazo: t.prazo, origem: t.desc };
    });
    return best;
  }

  /* ---------- render ---------- */
  var FILTROS = {
    'Em andamento': aberto,
    'Aguardando': function (s) { return /^Aguardando/.test(s.situacao); },
    'Na fila': function (s) { return s.situacao === 'Na fila'; },
    'Paralisados': function (s) { return s.situacao === 'Paralisado'; },
    'Concluídos': function (s) { return s.situacao === 'Concluído'; },
    'Todos': function () { return true; }
  };
  function render() {
    if (!st.d) return;
    $('#hoje').textContent = new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' });
    renderStats(); renderFiltros(); renderLista(); renderFinanceiro();
    ocupado(st.ocupado);
  }
  function renderStats() {
    var ab = st.d.servicos.filter(aberto), pe = ab.map(prazoEfetivo);
    var c = function (f) { return ab.filter(f).length; };
    var venc = pe.filter(function (p) { return p && p.dias < 0; }).length, sem = pe.filter(function (p) { return p && p.dias >= 0 && p.dias <= 7; }).length;
    var x = [
      ['Ativos', ab.length, '', 'Em andamento'],
      ['Em execução', c(function (s) { return s.situacao === 'Em andamento'; }), '', 'Em andamento'],
      ['Aguardando', c(function (s) { return /^Aguardando/.test(s.situacao); }), '', 'Aguardando'],
      ['Na fila', c(function (s) { return s.situacao === 'Na fila'; }), '', 'Na fila'],
      ['Prazo vencido', venc, venc ? 'bad' : 'zero', 'Em andamento'],
      ['Vence em 7 dias', sem, sem ? 'warn' : 'zero', 'Em andamento']
    ];
    $('#stats').innerHTML = x.map(function (k) { return '<button class="stat ' + k[2] + '" data-filtro="' + k[3] + '"><dt>' + k[0] + '</dt><dd>' + k[1] + '</dd></button>'; }).join('');
  }
  function renderFiltros() {
    $('#filtros').innerHTML = Object.keys(FILTROS).map(function (f) {
      var n = st.d.servicos.filter(FILTROS[f]).length;
      if (!n && f !== st.filtro && f !== 'Em andamento' && f !== 'Todos') return '';
      return '<button role="tab" aria-selected="' + (f === st.filtro) + '" class="' + (f === st.filtro ? 'on' : '') + '" data-filtro="' + f + '">' + f + '<span>' + n + '</span></button>';
    }).join('');
  }
  function renderLista() {
    var q = norm(st.busca);
    var L = st.d.servicos.filter(FILTROS[st.filtro]).filter(function (s) { return !q || norm(s.cliente + ' ' + s.servico).indexOf(q) >= 0; })
      .map(function (s) { return { s: s, p: prazoEfetivo(s) }; })
      .sort(function (a, b) { var x = a.p ? a.p.dias : 1e9, y = b.p ? b.p.dias : 1e9; return x - y || String(a.s.servico).localeCompare(b.s.servico); });
    if (!L.length) { $('#lista').innerHTML = '<div class="vazio-lista">Nenhum serviço aqui. Troque o filtro ou crie um em <b>Novo serviço</b>.</div>'; return; }
    var ordem = ['Prazo vencido', 'Vence em 7 dias', 'Com prazo', 'Sem prazo'], grupos = {};
    L.forEach(function (o) {
      var g = !aberto(o.s) ? o.s.situacao : !o.p ? 'Sem prazo' : o.p.dias < 0 ? 'Prazo vencido' : o.p.dias <= 7 ? 'Vence em 7 dias' : 'Com prazo';
      (grupos[g] = grupos[g] || []).push(o);
    });
    var chaves = ordem.filter(function (g) { return grupos[g]; }).concat(Object.keys(grupos).filter(function (g) { return ordem.indexOf(g) < 0; }));
    $('#lista').innerHTML = chaves.map(function (g) {
      var cls = g === 'Prazo vencido' ? ' bad' : g === 'Vence em 7 dias' ? ' warn' : '';
      return '<div class="grupo' + cls + '">' + esc(g) + ' <span class="n">' + grupos[g].length + '</span></div>' + grupos[g].map(linhaServico).join('');
    }).join('');
  }
  function linhaServico(o) {
    var s = o.s, p = o.p, fim = s.situacao === 'Concluído';
    var t = fim ? '' : !aberto(s) || s.situacao === 'Paralisado' ? 't-idle' : p ? 't-' + (tom(p.dias) || 'ok') : 't-idle';
    var badge = s.situacao === 'Em andamento' ? '' : '<span class="badge ' + (/^Aguardando/.test(s.situacao) ? 'aguardando' : fim ? 'ok' : '') + '">' + esc(s.situacao) + '</span>';
    var prazo = fim ? '<div class="col col-prazo"><small>Concluído</small><b>' + dataBR(s.concluido) + '</b></div>'
      : !p ? '<div class="col col-prazo"><small>Prazo</small><b class="nada">sem prazo</b></div>'
      : '<div class="col col-prazo ' + tom(p.dias) + '"><small>Prazo</small><b>' + dataBR(p.prazo) + '</b><span class="s">' + diasTxt(p.dias) + (p.origem ? ' · ' + esc(p.origem) : '') + '</span></div>';
    var valor;
    if (fim && s.valor == null && s.pagamento !== 'Sem pagamento') valor = '<div class="col col-valor"><small>Valor</small><span class="falta">informar valor</span></div>';
    else if (fim) valor = '<div class="col col-valor"><small>Valor</small><b>' + (s.valor != null ? brl(s.valor) : 'sem pagamento') + '</b><span class="com">comissão ' + brl(s.comissao || 0) + '</span></div>';
    else valor = '<div class="col col-valor"><small>Valor</small>' + (s.valor != null ? '<b>' + brl(s.valor) + '</b>' : '<b class="nada">a definir</b>') + '</div>';
    var subs = subtopicos(s.id);
    return '<div class="item ' + t + (fim ? ' feito' : '') + '" data-item="' + esc(s.id) + '">' +
      '<div class="linha">' +
        '<button class="ck" data-ck-serv="' + esc(s.id) + '" aria-label="' + (fim ? 'Reabrir ' : 'Concluir ') + esc(s.servico) + '"><svg class="ico"><use href="#i-check"/></svg></button>' +
        '<div class="corpo" data-editar="' + esc(s.id) + '"><div class="titulo">' + esc(s.servico) + '</div>' +
          '<div class="info"><span>' + esc(s.cliente) + '</span>' + badge + '</div></div>' +
        prazo + valor +
        '<div class="acoes">' +
          '<button class="icon-btn" data-novo-sub="' + esc(s.id) + '" title="Novo subtópico" aria-label="Novo subtópico"><svg class="ico"><use href="#i-topic"/></svg></button>' +
          '<button class="icon-btn so-pc" data-editar="' + esc(s.id) + '" title="Editar serviço" aria-label="Editar serviço"><svg class="ico"><use href="#i-edit"/></svg></button>' +
          '<button class="icon-btn danger" data-del-serv="' + esc(s.id) + '" title="Excluir serviço" aria-label="Excluir serviço"><svg class="ico"><use href="#i-trash"/></svg></button>' +
        '</div>' +
      '</div>' +
      (subs.length ? '<div class="arvore">' + subs.map(noSubtopico).join('') + '</div>' : '') +
    '</div>';
  }
  function meta(t) {
    var feita = t.situacao === 'Concluída', m = [], d = t.dias != null ? t.dias : diasAte(t.prazo);
    if (!feita && t.situacao !== 'A fazer') m.push(esc(t.situacao));
    if (t.prazo) m.push(dataCurta(t.prazo) + (!feita && d != null ? ' · ' + diasTxt(d) : ''));
    return { cls: feita ? '' : tom(d), txt: m.join(' · ') };
  }
  function noSubtopico(t) {
    var feita = t.situacao === 'Concluída', m = meta(t), its = itens(t.id);
    return '<div class="no' + (feita ? ' feito' : '') + '" data-item="' + esc(t.id) + '">' +
      '<div class="no-linha">' +
        '<button class="ck" data-ck-tar="' + esc(t.id) + '" aria-label="' + (feita ? 'Reabrir ' : 'Concluir ') + esc(t.desc) + '"><svg class="ico"><use href="#i-check"/></svg></button>' +
        '<span class="no-titulo" data-ed-tar="' + esc(t.id) + '">' + esc(t.desc) + '</span>' +
        '<span class="no-meta ' + m.cls + '">' + m.txt + '</span>' +
        '<button class="icon-btn" data-novo-item="' + esc(t.id) + '" title="Novo item" aria-label="Novo item"><svg class="ico"><use href="#i-plus"/></svg></button>' +
      '</div>' +
      (its.length ? '<div class="itens">' + its.map(linhaItem).join('') + '</div>' : '') +
    '</div>';
  }
  function linhaItem(t) {
    var feita = t.situacao === 'Concluída', m = meta(t);
    return '<div class="it' + (feita ? ' feito' : '') + '" data-item="' + esc(t.id) + '">' +
      '<button class="ck" data-ck-tar="' + esc(t.id) + '" aria-label="' + (feita ? 'Reabrir ' : 'Concluir ') + esc(t.desc) + '"><svg class="ico"><use href="#i-check"/></svg></button>' +
      '<span class="it-txt" data-ed-tar="' + esc(t.id) + '">' + esc(t.desc) + '</span>' +
      '<span class="it-meta ' + m.cls + '">' + m.txt + '</span>' +
      '<button class="icon-btn danger" data-del-tar="' + esc(t.id) + '" title="Excluir item" aria-label="Excluir item"><svg class="ico"><use href="#i-trash"/></svg></button></div>';
  }

  /* ---------- financeiro ---------- */
  function renderFinanceiro() {
    var S = st.d.servicos, ab = S.filter(aberto), pct = st.d.pct;
    var conc = S.filter(function (s) { return s.situacao === 'Concluído'; });
    var soma = function (a, f) { return a.reduce(function (t, s) { return t + (Number(f(s)) || 0); }, 0); };
    var semValor = conc.filter(function (s) { return s.valor == null && s.pagamento !== 'Sem pagamento'; });
    var carteira = soma(ab, function (s) { return s.valor; });
    var gerada = soma(conc, function (s) { return s.comissao; });
    var repassar = soma(conc.filter(function (s) { return !s.repasse; }), function (s) { return s.comissao; });
    var k = [
      ['Carteira ativa', brl(carteira), ab.filter(function (s) { return s.valor != null; }).length + ' de ' + ab.length + ' serviços com valor', ''],
      ['Comissão prevista (' + Math.round(pct * 100) + '%)', brl(carteira * pct), 'se a carteira for concluída', ''],
      ['Comissão gerada', brl(gerada), conc.length + ' serviço(s) concluído(s)', ''],
      [repassar === gerada ? 'A repassar (tudo)' : 'A repassar', brl(repassar), 'sem data de repasse', '']
    ];
    if (semValor.length) k[3] = ['Concluídos sem valor', semValor.length, 'informe o valor para calcular', 'alerta-k'];
    $('#kpis').innerHTML = k.map(function (x) { return '<div class="kpi ' + x[3] + '"><small>' + x[0] + '</small><b>' + esc(x[1]) + '</b><span>' + esc(x[2]) + '</span></div>'; }).join('');
    $('#fin-tabela').innerHTML = conc.length ? '<table><thead><tr><th>Serviço</th><th>Cliente</th><th class="n">Concluído</th><th class="n">Valor</th><th class="n">Comissão</th><th class="n">Repasse</th></tr></thead><tbody>' +
      conc.sort(function (a, b) { return String(b.concluido).localeCompare(a.concluido); }).map(function (s) {
        var falta = s.valor == null && s.pagamento !== 'Sem pagamento';
        return '<tr class="' + (falta ? 'falta' : '') + '"><td><span class="link" data-editar="' + esc(s.id) + '">' + esc(s.servico) + '</span></td><td>' + esc(s.cliente) + '</td><td class="n">' + dataBR(s.concluido) + '</td>' +
          '<td class="n">' + (falta ? 'informar' : s.valor != null ? brl(s.valor) : '—') + '</td><td class="n">' + brl(s.comissao || 0) + '</td><td class="n">' + (dataBR(s.repasse) || 'a repassar') + '</td></tr>';
      }).join('') + '</tbody></table>' : '<p class="muted">Nenhum serviço concluído ainda.</p>';
  }

  /* ---------- janela: serviço ---------- */
  function abrirServico(id) {
    var s = id ? servico(id) : null, f = $('#s-form'), d = $('#dlg-serv');
    st.edServ = id || null;
    f.situacao.innerHTML = (st.d ? st.d.situacoes : ['Em andamento']).map(function (x) { return '<option>' + esc(x) + '</option>'; }).join('');
    $('#s-eyebrow').textContent = s ? 'Editar serviço' + (s.atualizado ? ' · atualizado em ' + dataBR(s.atualizado) : '') : 'Novo serviço';
    $('#s-titulo').textContent = s ? s.servico : 'Novo serviço';
    $('#s-rapido').hidden = !!s; $('#s-excluir').hidden = !s;
    var v = s || { situacao: 'Em andamento', pagamento: 'A definir', entrada: new Date().toISOString().slice(0, 10) };
    ['cliente', 'servico', 'situacao', 'pagamento', 'entrada', 'prazo', 'repasse', 'obs'].forEach(function (k) { f[k].value = v[k] || ''; });
    f.valor.value = v.valor != null ? Number(v.valor).toLocaleString('pt-BR', { minimumFractionDigits: 2 }) : '';
    var c = $('#s-comissao');
    c.textContent = ''; c.className = 'comissao';
    if (s && s.situacao === 'Concluído') {
      var pend = s.valor == null && s.pagamento !== 'Sem pagamento';
      c.textContent = pend ? 'Concluído sem valor. Informe o valor ou marque Pagamento como "Sem pagamento".' : 'Comissão (' + Math.round(st.d.pct * 100) + '%): ' + brl(s.comissao || 0) + (s.repasse ? ' · repassada em ' + dataBR(s.repasse) : ' · a repassar');
      if (pend) c.className = 'comissao pend';
    } else if (s && s.valor != null) c.textContent = 'Comissão prevista: ' + brl(s.valor * st.d.pct);
    $('#s-rapido-in').value = '';
    d.showModal();
    setTimeout(function () { (s ? f.servico : $('#s-rapido-in')).focus(); }, 30);
  }
  $('#s-rapido').addEventListener('submit', function (e) {
    e.preventDefault();
    var i = $('#s-rapido-in'), texto = i.value.trim();
    if (!texto) return i.focus();
    acao({ tipo: 'rapido', texto: texto }).then(function (v) { if (!/^✖/.test(v.msg || '')) $('#dlg-serv').close(); }).catch(function () {});
  });
  $('#s-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var f = this, c = {};
    ['cliente', 'servico', 'situacao', 'pagamento', 'entrada', 'prazo', 'repasse', 'obs'].forEach(function (k) { c[k] = f[k].value.trim(); });
    c.valor = f.valor.value.trim() ? num(f.valor.value) : '';
    if (f.valor.value.trim() && c.valor == null) return toast('Valor inválido. Exemplo: 1.500,00', true);
    $('#dlg-serv').close();
    acao({ tipo: 'salvarServico', id: st.edServ, campos: c }, st.edServ).catch(function () {});
  });
  $('#s-excluir').addEventListener('click', function () { if (excluirServico(st.edServ)) $('#dlg-serv').close(); });

  /* ---------- janela: subtópico / item ---------- */
  // modo: {servico, pai?} para criar; {id} para editar
  function abrirTarefa(modo) {
    var f = $('#t-form'), t = modo.id ? tarefa(modo.id) : null;
    var sid = t ? t.servico : modo.servico, s = servico(sid) || {};
    var ehItem = t ? !!t.pai : !!modo.pai;
    st.edTar = { id: t ? t.id : null, servico: sid, pai: t ? t.pai : modo.pai || '' };
    f.situacao.innerHTML = (st.d.situacoesTarefa || ['A fazer', 'Concluída']).map(function (x) { return '<option>' + esc(x) + '</option>'; }).join('');
    var pai = ehItem ? tarefa(st.edTar.pai) : null;
    $('#t-eyebrow').textContent = s.servico + (pai ? ' › ' + pai.desc : '');
    $('#t-titulo').textContent = t ? (ehItem ? 'Editar item' : 'Editar subtópico') : (ehItem ? 'Novo item' : 'Novo subtópico');
    $('#t-desc-lbl').firstChild.textContent = ehItem ? 'Item' : 'Subtópico';
    f.desc.placeholder = ehItem ? 'Ex.: Juntar fotos da vistoria' : 'Ex.: Informação complementar';
    f.desc.value = t ? t.desc : ''; f.prazo.value = t ? t.prazo : ''; f.obs.value = t ? t.obs || '' : ''; f.situacao.value = t ? t.situacao : 'A fazer';
    $('#t-salvar').textContent = t ? 'Salvar' : 'Adicionar';
    $('#t-excluir').hidden = !t;
    $('#dlg-tar').showModal();
    setTimeout(function () { f.desc.focus(); }, 30);
  }
  $('#t-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var f = this, e2 = st.edTar;
    var campos = { desc: f.desc.value.trim(), prazo: f.prazo.value, situacao: f.situacao.value, obs: f.obs.value.trim() };
    if (!e2.id) { campos.servico = e2.servico; campos.pai = e2.pai; }
    $('#dlg-tar').close();
    acao({ tipo: 'salvarTarefa', id: e2.id, campos: campos }, e2.id || e2.servico).catch(function () {});
  });
  $('#t-excluir').addEventListener('click', function () { if (excluirTarefa(st.edTar.id)) $('#dlg-tar').close(); });
  $$('[data-fechar]').forEach(function (b) { b.addEventListener('click', function () { b.closest('dialog').close(); }); });
  $$('dialog').forEach(function (d) { d.addEventListener('click', function (e) { if (e.target === d) d.close(); }); });

  function excluirServico(id) {
    var s = servico(id), n = st.d.tarefas.filter(function (t) { return t.servico === id; }).length;
    if (!confirm('Excluir "' + s.servico + ' — ' + s.cliente + '"' + (n ? ' e seus ' + n + ' subtópicos/itens' : '') + '? Não dá para desfazer.')) return false;
    acao({ tipo: 'excluirServico', id: id }, id).catch(function () {});
    return true;
  }
  function excluirTarefa(id) {
    var t = tarefa(id), filhos = itens(id);
    if (!confirm('Excluir "' + t.desc + '"' + (filhos.length ? ' e seus ' + filhos.length + ' itens' : '') + '? Não dá para desfazer.')) return false;
    filhos.concat([t]).reduce(function (p, x) { return p.then(function () { return acao({ tipo: 'excluirTarefa', id: x.id }, x.id); }); }, Promise.resolve()).catch(function () {});
    return true;
  }

  /* ---------- conclusão sem valor ---------- */
  function pedirValor(id) {
    var s = servico(id), d = $('#dlg-valor');
    $('#dlg-nome').textContent = s ? s.servico + ' — ' + s.cliente : id;
    $('#dlg-valor-in').value = '';
    d.dataset.id = id; d.returnValue = '';
    d.showModal(); setTimeout(function () { $('#dlg-valor-in').focus(); }, 50);
  }
  $('#dlg-valor').addEventListener('close', function () {
    var id = this.dataset.id, r = this.returnValue;
    if (r === 'valor') {
      var n = num($('#dlg-valor-in').value);
      if (!n) { toast('Valor inválido. Exemplo: 1.500,00', true); return pedirValor(id); }
      acao({ tipo: 'concluir', id: id, valor: n }, id);
    } else if (r === 'sem') acao({ tipo: 'concluir', id: id, pagamento: 'Sem pagamento' }, id);
    else if (r === 'depois') toast('Valor pendente. O serviço aparece em Financeiro como "sem valor".');
  });

  /* ---------- eventos ---------- */
  document.addEventListener('click', function (e) {
    var el = e.target.closest('[data-filtro],[data-view],[data-ck-serv],[data-ck-tar],[data-del-serv],[data-del-tar],[data-novo-sub],[data-novo-item],[data-ed-tar],[data-editar]');
    if (!el || (!st.d && !el.dataset.view)) return;
    var ds = el.dataset;
    if (ds.view) return mudarView(ds.view);
    if (ds.filtro) { st.filtro = ds.filtro; mudarView('servicos'); renderFiltros(); renderLista(); return; }
    if (ds.ckServ) {
      var s = servico(ds.ckServ);
      if (s.situacao === 'Concluído') { if (confirm('Reabrir "' + s.servico + '"? Ele volta para Em andamento e sai da comissão.')) acao({ tipo: 'salvarServico', id: s.id, campos: { situacao: 'Em andamento' } }, s.id); }
      else acao({ tipo: 'salvarServico', id: s.id, campos: { situacao: 'Concluído' } }, s.id);
      return;
    }
    if (ds.ckTar) { var t = tarefa(ds.ckTar); return acao({ tipo: 'salvarTarefa', id: t.id, campos: { situacao: t.situacao === 'Concluída' ? 'A fazer' : 'Concluída' } }, t.id); }
    if (ds.delServ) return excluirServico(ds.delServ);
    if (ds.delTar) return excluirTarefa(ds.delTar);
    if (ds.novoSub) return abrirTarefa({ servico: ds.novoSub });
    if (ds.novoItem) return abrirTarefa({ servico: tarefa(ds.novoItem).servico, pai: ds.novoItem });
    if (ds.edTar) return abrirTarefa({ id: ds.edTar });
    if (ds.editar) return abrirServico(ds.editar);
  });
  function mudarView(v) {
    st.view = v; $('#view-servicos').hidden = v !== 'servicos'; $('#view-financeiro').hidden = v !== 'financeiro';
    $('#titulo-view').textContent = v === 'financeiro' ? 'Financeiro' : 'Serviços em andamento';
    $('#stats').hidden = v !== 'servicos';
    $$('.tab[data-view]').forEach(function (b) { b.classList.toggle('on', b.dataset.view === v); });
  }
  $('#btn-novo').addEventListener('click', function () { if (st.d) abrirServico(null); });
  $('#busca').addEventListener('input', function () { st.busca = this.value; renderLista(); });
  $('#btn-sync').addEventListener('click', function () { carregar(); });
  $('#btn-tema').addEventListener('click', function () {
    var t = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = t; try { localStorage.setItem('ps-tema2', t); } catch (e) {}
  });
  $('#btn-entrar').addEventListener('click', entrar);
  $('#conta').addEventListener('click', function () { if (lerToken()) { if (confirm('Sair da conta ' + (contaSalva() || '') + '?')) sair(); } else entrar(); });

  /* ---------- modo demonstração (?demo) ---------- */
  function demoApi(body) {
    var d = st.d && st.d.demo ? st.d : JSON.parse(JSON.stringify(window.PS_DEMO));
    d.ok = true; d.demo = true; d.geradoEm = new Date().toISOString();
    if (body.rota === 'acao') {
      d.msg = '✔ (demonstração) ' + (body.tipo || '');
      if (body.tipo === 'salvarTarefa' && !body.id) d.tarefas.push(Object.assign({ id: 'AT-D' + d.tarefas.length, cliente: '', tipo: body.campos.pai ? 'Subtarefa' : 'Tarefa', situacao: 'A fazer', dias: null }, body.campos));
      if (body.tipo === 'salvarTarefa' && body.id) Object.assign(tarefa(body.id), body.campos);
      if (body.tipo === 'excluirTarefa') d.tarefas = d.tarefas.filter(function (t) { return t.id !== body.id; });
      if (body.tipo === 'excluirServico') d.servicos = d.servicos.filter(function (s) { return s.id !== body.id; });
    }
    st.d = d; render();
    return Promise.resolve(d);
  }

  /* ---------- início ---------- */
  if ('serviceWorker' in navigator && !DEMO && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(function () {});
  conta();
  if (DEMO) { var sc = document.createElement('script'); sc.src = 'demo.js'; sc.onload = carregar; document.body.appendChild(sc); return; }
  try { st.d = JSON.parse(localStorage.getItem(CACHE) || 'null'); } catch (e) {}
  if (st.d) render();
  if (lerToken()) carregar();
  else if (!st.d) telaLogin();
  else toast('Mostrando os dados salvos. Toque em "Entrar para atualizar".');
  setInterval(function () { if (!document.hidden && lerToken() && !st.ocupado) carregar(); }, 5 * 60 * 1000);
  document.addEventListener('visibilitychange', function () { if (!document.hidden && lerToken() && st.d && Date.now() - new Date(st.d.geradoEm) > 60000) carregar(); });
})();

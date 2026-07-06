import React, { useState, useEffect, useRef } from 'react';
import { createClient } from '@supabase/supabase-js';
import * as XLSX from 'xlsx';
import emailjs from '@emailjs/browser';

// ── Configuración ──────────────────────────────────────────────────────────────
const SUPABASE_URL  = 'https://cttogqopzncphfvukhgf.supabase.co';
const SUPABASE_KEY  = 'sb_publishable_ByOaP-JMrhOsjgCn87jM_g_QFFhZNT0';
const supabase      = createClient(SUPABASE_URL, SUPABASE_KEY);

const EJS_SERVICE   = 'service_oyce136';
const EJS_TEMPLATE  = 'template_7mepnqg';
const EJS_PUBLIC    = 'ZMsvylkrklU4MQ-Bx';

// ── Colores verdes ─────────────────────────────────────────────────────────────
const C = {
  950:"#022c22",900:"#064e3b",800:"#065f46",700:"#047857",
  600:"#059669",500:"#10b981",400:"#34d399",300:"#6ee7b7",
  200:"#a7f3d0",100:"#d1fae5",50:"#ecfdf5",
};

// ── Helpers ────────────────────────────────────────────────────────────────────
const fCOP = n => new Intl.NumberFormat('es-CO',{style:'currency',currency:'COP',minimumFractionDigits:0}).format(n||0);
const fFecha = d => { if(!d) return '—'; const f = new Date(d); return isNaN(f)?'—':f.toLocaleDateString('es-CO'); };
const fFechaHora = d => { if(!d) return '—'; const f = new Date(d); return isNaN(f)?'—':f.toLocaleString('es-CO'); };

const ESTADOS_CARTERA = {
  pendiente:       {label:"Pendiente",       color:"#d97706",bg:"#fffbeb"},
  preaprobado:     {label:"Preaprobado",     color:"#059669",bg:"#ecfdf5"},
  cartera_vencida: {label:"Cartera Vencida", color:"#dc2626",bg:"#fef2f2"},
  aprobado:        {label:"Aprobado",        color:"#0891b2",bg:"#ecfeff"},
  rechazado:       {label:"Rechazado",       color:"#64748b",bg:"#f1f5f9"},
};

const ROLES = {admin:"Administrador",cartera:"Cartera",logistica:"Logística",consultas:"Consultas"};

// ── Asignar corte ──────────────────────────────────────────────────────────────
const asignarCorte = async (daneOrigen) => {
  if (!daneOrigen) return null;
  const hoy = new Date().toISOString().split('T')[0];
  const ahora = new Date();

  const {data:sedesAll} = await supabase
    .from('sedes').select('*, cortes_sede(*)').eq('activa',true);

  if (!sedesAll || sedesAll.length === 0) return null;
  const daneNorm = daneOrigen.trim().padStart(5,'0'); // "5380" -> "05380"
  const sede = sedesAll.find(s=>{
    const cNorm = String(s.dane_code||'').trim().padStart(5,'0');
    return cNorm === daneNorm;
  });
  if (!sede) return null;
  const cortesOrdenados = (sede.cortes_sede||[]).sort((a,b)=>a.orden-b.orden);
  if (cortesOrdenados.length === 0) return null;

  // Intentar en los cortes de hoy
  for (const cs of cortesOrdenados) {
    const corteTime = new Date(hoy+'T'+cs.hora_corte);
    if (corteTime <= ahora) continue;

    let {data:cp} = await supabase.from('cortes_programados')
      .select('*').eq('sede_id',sede.id).eq('corte_sede_id',cs.id).eq('fecha',hoy).maybeSingle();

    if (!cp) {
      const {data:nuevo} = await supabase.from('cortes_programados').insert({
        sede_id:sede.id, corte_sede_id:cs.id, fecha:hoy,
        hora_corte:cs.hora_corte, capacidad_max:cs.capacidad_corte,
        pedidos_asignados:0, estado:'abierto'
      }).select().single();
      cp = nuevo;
    }

    if (cp && cp.pedidos_asignados < cp.capacidad_max && cp.estado==='abierto') {
      await supabase.from('cortes_programados')
        .update({pedidos_asignados:cp.pedidos_asignados+1}).eq('id',cp.id);
      return {corteId:cp.id, fechaCorte:new Date(hoy+'T'+cs.hora_corte).toISOString(), sedeNombre:sede.nombre, horaCorte:cs.hora_corte};
    }
  }

  // Si todos los cortes de hoy están llenos → mañana primer corte
  const man = new Date(); man.setDate(man.getDate()+1);
  const manStr = man.toISOString().split('T')[0];
  const primerCorte = cortesOrdenados[0];

  let {data:cp} = await supabase.from('cortes_programados')
    .select('*').eq('sede_id',sede.id).eq('corte_sede_id',primerCorte.id).eq('fecha',manStr).maybeSingle();

  if (!cp) {
    const {data:nuevo} = await supabase.from('cortes_programados').insert({
      sede_id:sede.id, corte_sede_id:primerCorte.id, fecha:manStr,
      hora_corte:primerCorte.hora_corte, capacidad_max:primerCorte.capacidad_corte,
      pedidos_asignados:0, estado:'abierto'
    }).select().single();
    cp = nuevo;
  }

  if (cp) {
    await supabase.from('cortes_programados')
      .update({pedidos_asignados:cp.pedidos_asignados+1}).eq('id',cp.id);
    return {corteId:cp.id, fechaCorte:new Date(manStr+'T'+primerCorte.hora_corte).toISOString(), sedeNombre:sede.nombre, horaCorte:primerCorte.hora_corte};
  }
  return null;
};

// ── Enviar correo de rechazo ───────────────────────────────────────────────────
const enviarCorreoRechazo = async (pedido, motivo, emailAsesor) => {
  if (!emailAsesor) return;
  try {
    emailjs.init(EJS_PUBLIC);
    await emailjs.send(EJS_SERVICE, EJS_TEMPLATE, {
      numero_pedido: pedido.numero_pedido,
      cliente:       pedido.cliente,
      nit:           pedido.nit,
      motivo:        motivo,
      to_email:      emailAsesor,
    });
  } catch(e) { console.error('Error enviando correo:', e); }
};

// ── Componentes base ───────────────────────────────────────────────────────────
function Card({children, style={}}) {
  return <div style={{background:"#fff",borderRadius:14,boxShadow:`0 2px 16px ${C[600]}10`,padding:20,border:`1px solid ${C[100]}`,...style}}>{children}</div>;
}

function Btn({children,onClick,variant="primary",size="md",style={},disabled=false,type="button"}) {
  const sz={sm:{padding:"5px 12px",fontSize:12},md:{padding:"9px 16px",fontSize:13},lg:{padding:"12px 24px",fontSize:14}};
  const vr={
    primary:  {background:`linear-gradient(135deg,${C[700]},${C[600]})`,color:"#fff",boxShadow:`0 2px 8px ${C[600]}40`},
    secondary:{background:C[50],color:C[700],border:`1px solid ${C[200]}`},
    success:  {background:"linear-gradient(135deg,#059669,#10b981)",color:"#fff"},
    danger:   {background:"#fef2f2",color:"#dc2626",border:"1px solid #fca5a5"},
    ghost:    {background:"transparent",color:"#64748b",border:"1px solid #e2e8f0"},
    warning:  {background:"#fffbeb",color:"#d97706",border:"1px solid #fcd34d"},
  };
  return <button type={type} onClick={disabled?undefined:onClick} disabled={disabled} style={{border:"none",cursor:disabled?"not-allowed":"pointer",borderRadius:9,fontWeight:700,fontFamily:"inherit",display:"inline-flex",alignItems:"center",gap:6,opacity:disabled?0.5:1,...sz[size],...vr[variant],...style}}>{children}</button>;
}

function Field({label,value,onChange,type="text",placeholder="",as="input",options=[],style={},readOnly=false,required=false}) {
  const base={border:`1.5px solid ${C[200]}`,borderRadius:9,padding:"9px 13px",fontSize:13,fontFamily:"inherit",outline:"none",background:readOnly?"#f8fafb":"#fafafa",width:"100%",boxSizing:"border-box"};
  return (
    <div style={{display:"flex",flexDirection:"column",gap:4,...style}}>
      {label&&<label style={{fontSize:11,fontWeight:700,color:C[700],textTransform:"uppercase",letterSpacing:0.5}}>{label}{required&&<span style={{color:"#ef4444"}}> *</span>}</label>}
      {as==="select"?<select value={value} onChange={e=>onChange(e.target.value)} style={base} disabled={readOnly}>
        {options.map(o=><option key={o.value} value={o.value}>{o.label}</option>)}
      </select>:as==="textarea"?<textarea value={value} onChange={e=>onChange(e.target.value)} placeholder={placeholder} rows={3} style={{...base,resize:"vertical"}} readOnly={readOnly}/>:
      <input type={type} value={value} onChange={e=>onChange(e.target.value)} placeholder={placeholder} style={base} readOnly={readOnly}/>}
    </div>
  );
}

function Modal({title,children,onClose,wide=false,extraWide=false}) {
  return (
    <div onClick={e=>{if(e.target===e.currentTarget)onClose();}} style={{position:"fixed",inset:0,background:"#00000088",zIndex:1000,display:"flex",alignItems:"center",justifyContent:"center",padding:16}}>
      <div style={{background:"#fff",borderRadius:18,padding:24,width:"100%",maxWidth:extraWide?900:wide?680:500,maxHeight:"92vh",overflowY:"auto",boxShadow:"0 20px 60px #0004"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20}}>
          <h3 style={{margin:0,fontSize:17,color:C[800],fontWeight:800}}>{title}</h3>
          <button onClick={onClose} style={{border:"none",background:C[50],cursor:"pointer",fontSize:18,color:C[600],width:32,height:32,borderRadius:7,display:"flex",alignItems:"center",justifyContent:"center"}}>×</button>
        </div>
        {children}
      </div>
    </div>
  );
}

function Toast({msg,type,onDone}) {
  useEffect(()=>{const t=setTimeout(onDone,4000);return()=>clearTimeout(t);},[]);
  const clr={success:C[600],error:"#dc2626",info:"#0891b2",warning:"#d97706"};
  return <div style={{position:"fixed",bottom:24,right:24,background:clr[type]||C[700],color:"#fff",padding:"12px 20px",borderRadius:12,fontWeight:700,fontSize:13,zIndex:9999,boxShadow:"0 6px 24px #0004",maxWidth:340,lineHeight:1.5,animation:"fadein .3s"}}>{msg}</div>;
}

function BadgeEstado({estado}) {
  const e = ESTADOS_CARTERA[estado]||ESTADOS_CARTERA.pendiente;
  return <span style={{background:e.bg,color:e.color,border:`1px solid ${e.color}40`,borderRadius:20,padding:"3px 10px",fontSize:11,fontWeight:700,whiteSpace:"nowrap"}}>{e.label}</span>;
}

// ── Sidebar ────────────────────────────────────────────────────────────────────
function Sidebar({user,activeTab,setActiveTab,onLogout,collapsed,setCollapsed}) {
  const menus = {
    admin:    [["sedes","🏭","Sedes y Cortes"],["asesores","👤","Asesores"],["usuarios","👥","Usuarios"],["cargar_cartera","📋","Cargar Cartera"],["cargar_pedidos","📤","Cargar Pedidos"],["gestion","✅","Gestión Pedidos"],["logistica","🖨️","Logística"],["consultas","🔍","Consultas"]],
    cartera:  [["cargar_cartera","📋","Cargar Cartera"],["cargar_pedidos","📤","Cargar Pedidos"],["gestion","✅","Gestión Pedidos"]],
    logistica:[["logistica","🖨️","Logística"],["consultas","🔍","Consultas"]],
    consultas:[["consultas","🔍","Estado Pedidos"]],
  };
  const items = menus[user.rol]||[];
  return (
    <div style={{width:collapsed?58:220,minHeight:"100vh",background:`linear-gradient(180deg,${C[950]} 0%,${C[800]} 100%)`,display:"flex",flexDirection:"column",transition:"width .25s",flexShrink:0}}>
      <div style={{padding:collapsed?"14px 8px":"16px 14px",display:"flex",alignItems:"center",justifyContent:collapsed?"center":"space-between",borderBottom:`1px solid ${C[700]}50`}}>
        {!collapsed&&<div><div style={{color:"#fff",fontWeight:900,fontSize:14}}>QTracking</div><div style={{color:C[400],fontSize:10}}>Cartera</div></div>}
        {collapsed&&<div style={{color:C[400],fontWeight:900,fontSize:13}}>QT</div>}
        <button onClick={()=>setCollapsed(!collapsed)} style={{background:`${C[700]}60`,border:"none",color:C[300],cursor:"pointer",borderRadius:5,width:24,height:24,display:"flex",alignItems:"center",justifyContent:"center",fontSize:13,flexShrink:0}}>{collapsed?"›":"‹"}</button>
      </div>
      {!collapsed&&<div style={{padding:"10px 14px",borderBottom:`1px solid ${C[700]}40`}}>
        <div style={{width:34,height:34,borderRadius:17,background:`linear-gradient(135deg,${C[500]},${C[400]})`,display:"flex",alignItems:"center",justifyContent:"center",color:"#fff",fontWeight:900,fontSize:14,marginBottom:6}}>{user.nombre[0].toUpperCase()}</div>
        <div style={{color:"#fff",fontSize:12,fontWeight:700}}>{user.nombre}</div>
        <div style={{color:C[400],fontSize:10,marginTop:1}}>{ROLES[user.rol]||user.rol}</div>
      </div>}
      <nav style={{flex:1,padding:"8px 0"}}>
        {items.map(([t,icon,label])=>(
          <button key={t} onClick={()=>setActiveTab(t)} style={{width:"100%",padding:collapsed?"10px":"9px 14px",background:activeTab===t?`${C[600]}50`:"none",border:"none",cursor:"pointer",display:"flex",alignItems:"center",gap:9,color:activeTab===t?"#fff":C[400],fontWeight:activeTab===t?700:400,fontSize:12,fontFamily:"inherit",borderLeft:activeTab===t?`3px solid ${C[300]}`:"3px solid transparent",justifyContent:collapsed?"center":"flex-start",transition:"all .15s"}}>
            <span style={{fontSize:16}}>{icon}</span>
            {!collapsed&&label}
          </button>
        ))}
      </nav>
      <button onClick={onLogout} style={{padding:collapsed?"10px":"10px 14px",background:"none",border:"none",cursor:"pointer",display:"flex",alignItems:"center",gap:9,color:"#f87171",fontSize:12,fontFamily:"inherit",fontWeight:600,borderTop:`1px solid ${C[700]}40`,justifyContent:collapsed?"center":"flex-start"}}>
        <span>🚪</span>{!collapsed&&"Cerrar Sesión"}
      </button>
    </div>
  );
}

// ── LOGIN ──────────────────────────────────────────────────────────────────────
function Login({onLogin, showToast}) {
  const [email, setEmail] = useState('');
  const [pass,  setPass]  = useState('');
  const [carg,  setCarg]  = useState(false);

  const ingresar = async () => {
    if (!email.trim()||!pass.trim()) { showToast("Ingresa usuario y contraseña","error"); return; }
    setCarg(true);
    try {
      const {data,error} = await supabase.from('usuarios_cartera')
        .select('*').eq('email',email.trim()).eq('password',pass.trim()).eq('activo',true).single();
      if (error||!data) { showToast("Usuario o contraseña incorrectos","error"); }
      else onLogin(data);
    } catch(e) { showToast("Sin conexión. Verifica tu internet","error"); }
    setCarg(false);
  };

  return (
    <div style={{minHeight:"100vh",background:`linear-gradient(160deg,${C[950]},${C[800]},${C[600]})`,display:"flex",alignItems:"center",justifyContent:"center",padding:16}}>
      <div style={{background:"#fff",borderRadius:22,padding:"36px 32px",width:"100%",maxWidth:400,boxShadow:"0 20px 60px #0004"}}>
        <div style={{textAlign:"center",marginBottom:28}}>
          <div style={{width:64,height:64,borderRadius:32,border:`3px solid ${C[600]}`,background:"#fff",display:"flex",alignItems:"center",justifyContent:"center",margin:"0 auto 12px",boxShadow:`0 4px 16px ${C[600]}30`}}>
            <span style={{fontSize:28}}>📋</span>
          </div>
          <div style={{fontSize:22,fontWeight:900,color:C[800]}}>QTracking Pedidos</div>
          <div style={{fontSize:12,color:"#64748b",marginTop:4}}>Sistema de Gestión de Pedidos</div>
        </div>
        <div style={{display:"flex",flexDirection:"column",gap:14}}>
          <Field label="Correo electrónico" value={email} onChange={setEmail} placeholder="usuario@empresa.com" type="email"/>
          <Field label="Contraseña" value={pass} onChange={setPass} placeholder="••••••••" type="password"/>
          <Btn onClick={ingresar} disabled={carg} size="lg" style={{width:"100%",justifyContent:"center",marginTop:4}}>
            {carg?"Ingresando...":"Ingresar al Sistema →"}
          </Btn>
        </div>
      </div>
    </div>
  );
}

// ── GESTIÓN SEDES ──────────────────────────────────────────────────────────────
function GestionSedes({showToast}) {
  const [sedes,     setSedes]     = useState([]);
  const [modSede,   setModSede]   = useState(null); // null=cerrado, {}=nueva, {id...}=editar
  const [modCortes, setModCortes] = useState(null); // sede para gestionar cortes
  const [carg,      setCarg]      = useState(false);
  const vacio = {nombre:'',municipio:'',dane_code:'',capacidad_dia:'50',hora_ultimo_corte:'16:00',num_cortes:'3',activa:true};
  const [form, setForm] = useState(vacio);
  const f = k => v => setForm(p=>({...p,[k]:v}));

  const cargar = async () => {
    const {data} = await supabase.from('sedes').select('*').order('nombre');
    setSedes(data||[]);
  };
  useEffect(()=>{cargar();},[]);

  const guardar = async () => {
    if(!form.nombre||!form.municipio||!form.dane_code){showToast("Completa todos los campos","error");return;}
    setCarg(true);
    const datos = {nombre:form.nombre.trim(),municipio:form.municipio.trim(),dane_code:form.dane_code.trim(),
      capacidad_dia:parseInt(form.capacidad_dia)||50,hora_ultimo_corte:form.hora_ultimo_corte,
      num_cortes:parseInt(form.num_cortes)||3,activa:form.activa};
    const {error} = form.id
      ? await supabase.from('sedes').update(datos).eq('id',form.id)
      : await supabase.from('sedes').insert(datos);
    if(error){showToast("Error: "+error.message,"error");}
    else{showToast(form.id?"✓ Sede actualizada":"✓ Sede creada","success");setModSede(null);setForm(vacio);cargar();}
    setCarg(false);
  };

  const eliminar = async (id,nombre) => {
    if(!window.confirm(`¿Eliminar sede "${nombre}"? Se eliminarán también sus cortes configurados.`))return;
    const {error} = await supabase.from('sedes').delete().eq('id',id);
    if(error)showToast("Error: "+error.message,"error");
    else{showToast("Sede eliminada","info");cargar();}
  };

  return (
    <div>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20,flexWrap:"wrap",gap:10}}>
        <h2 style={{margin:0,fontWeight:900}}>🏭 Sedes y Cortes de Despacho</h2>
        <Btn onClick={()=>{setForm(vacio);setModSede({});}}>+ Nueva Sede</Btn>
      </div>
      {sedes.length===0&&<Card style={{textAlign:"center",padding:40,color:"#94a3b8"}}>No hay sedes registradas. Agrega la primera sede para comenzar.</Card>}
      <div style={{display:"flex",flexDirection:"column",gap:12}}>
        {sedes.map(s=>(
          <Card key={s.id} style={{borderLeft:`4px solid ${s.activa?C[600]:"#94a3b8"}`}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",flexWrap:"wrap",gap:10}}>
              <div>
                <div style={{fontWeight:800,fontSize:16,color:s.activa?C[800]:"#94a3b8"}}>{s.nombre}</div>
                <div style={{fontSize:13,color:"#64748b",marginTop:4,display:"flex",gap:16,flexWrap:"wrap"}}>
                  <span>📍 {s.municipio}</span>
                  <span>🏷️ DANE: {s.dane_code}</span>
                  <span>📦 {s.capacidad_dia} pedidos/día</span>
                  <span>⏰ Último corte: {s.hora_ultimo_corte}</span>
                  <span>🔄 {s.num_cortes} cortes/día</span>
                  <span style={{color:s.activa?C[600]:"#94a3b8",fontWeight:700}}>{s.activa?"● Activa":"○ Inactiva"}</span>
                </div>
              </div>
              <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                <Btn size="sm" variant="secondary" onClick={()=>setModCortes(s)}>⏰ Cortes</Btn>
                <Btn size="sm" variant="secondary" onClick={()=>{setForm({...s,capacidad_dia:String(s.capacidad_dia),num_cortes:String(s.num_cortes)});setModSede(s);}}>✏️ Editar</Btn>
                <Btn size="sm" variant="danger" onClick={()=>eliminar(s.id,s.nombre)}>× Eliminar</Btn>
              </div>
            </div>
          </Card>
        ))}
      </div>

      {modSede!==null&&(
        <Modal title={form.id?"Editar Sede":"Nueva Sede"} onClose={()=>setModSede(null)}>
          <div style={{display:"flex",flexDirection:"column",gap:14}}>
            <Field label="Nombre de la sede *" value={form.nombre} onChange={f("nombre")} placeholder="Bodega Medellín"/>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
              <Field label="Municipio *" value={form.municipio} onChange={f("municipio")} placeholder="Medellín"/>
              <Field label="Código DANE *" value={form.dane_code} onChange={f("dane_code")} placeholder="05001"/>
            </div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:12}}>
              <Field label="Pedidos máx. por día" value={form.capacidad_dia} onChange={f("capacidad_dia")} type="number" placeholder="50"/>
              <Field label="Número de cortes" value={form.num_cortes} onChange={f("num_cortes")} type="number" placeholder="3"/>
              <Field label="Hora último corte" value={form.hora_ultimo_corte} onChange={f("hora_ultimo_corte")} type="time"/>
            </div>
            <div style={{display:"flex",alignItems:"center",gap:10,cursor:"pointer"}} onClick={()=>f("activa")(!form.activa)}>
              <div style={{width:20,height:20,borderRadius:5,border:`2px solid ${form.activa?C[600]:"#94a3b8"}`,background:form.activa?C[600]:"transparent",display:"flex",alignItems:"center",justifyContent:"center"}}>
                {form.activa&&<span style={{color:"#fff",fontSize:13,fontWeight:900}}>✓</span>}
              </div>
              <span style={{fontSize:13,fontWeight:600,color:"#334155"}}>Sede activa</span>
            </div>
            <div style={{display:"flex",gap:10,justifyContent:"flex-end"}}>
              <Btn variant="secondary" onClick={()=>setModSede(null)}>Cancelar</Btn>
              <Btn disabled={carg} onClick={guardar}>{carg?"Guardando...":"💾 Guardar Sede"}</Btn>
            </div>
          </div>
        </Modal>
      )}

      {modCortes&&<ModalCortes sede={modCortes} onClose={()=>setModCortes(null)} showToast={showToast}/>}
    </div>
  );
}

function ModalCortes({sede,onClose,showToast}) {
  const [cortes, setCortes] = useState([]);
  const [form,   setForm]   = useState({hora_corte:'09:00',capacidad_corte:'20',orden:'1'});
  const f = k => v => setForm(p=>({...p,[k]:v}));
  const [carg, setCarg] = useState(false);

  const cargar = async () => {
    const {data} = await supabase.from('cortes_sede').select('*').eq('sede_id',sede.id).order('orden');
    setCortes(data||[]);
  };
  useEffect(()=>{cargar();},[]);

  const agregar = async () => {
    if(!form.hora_corte||!form.capacidad_corte){showToast("Completa todos los campos","error");return;}
    setCarg(true);
    const {error} = await supabase.from('cortes_sede').insert({
      sede_id:sede.id,hora_corte:form.hora_corte,
      capacidad_corte:parseInt(form.capacidad_corte)||20,
      orden:parseInt(form.orden)||cortes.length+1
    });
    if(error)showToast("Error: "+error.message,"error");
    else{showToast("✓ Corte agregado","success");setForm({hora_corte:'09:00',capacidad_corte:'20',orden:String(cortes.length+2)});cargar();}
    setCarg(false);
  };

  const eliminar = async (id) => {
    await supabase.from('cortes_sede').delete().eq('id',id);
    showToast("Corte eliminado","info");
    cargar();
  };

  return (
    <Modal title={`Cortes — ${sede.nombre}`} onClose={onClose} wide>
      <div style={{display:"flex",flexDirection:"column",gap:16}}>
        <div style={{background:C[50],borderRadius:10,padding:14,border:`1px solid ${C[200]}`}}>
          <div style={{fontWeight:700,marginBottom:10,fontSize:13}}>➕ Agregar Corte</div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr auto",gap:10,alignItems:"end"}}>
            <Field label="Hora del corte" value={form.hora_corte} onChange={f("hora_corte")} type="time"/>
            <Field label="Pedidos máx." value={form.capacidad_corte} onChange={f("capacidad_corte")} type="number" placeholder="20"/>
            <Field label="Orden" value={form.orden} onChange={f("orden")} type="number" placeholder="1"/>
            <Btn disabled={carg} onClick={agregar} style={{alignSelf:"end"}}>+ Agregar</Btn>
          </div>
        </div>
        {cortes.length===0&&<div style={{textAlign:"center",padding:24,color:"#94a3b8",fontSize:13}}>No hay cortes configurados para esta sede.</div>}
        {cortes.length>0&&(
          <table style={{width:"100%",borderCollapse:"collapse",fontSize:13}}>
            <thead><tr style={{background:C[50]}}>
              {["Orden","Hora del Corte","Pedidos Máx.","Eliminar"].map(h=>(
                <th key={h} style={{padding:"9px 14px",textAlign:"left",fontWeight:700,color:C[700],fontSize:11}}>{h}</th>
              ))}
            </tr></thead>
            <tbody>
              {cortes.map((c,i)=>(
                <tr key={c.id} style={{borderTop:`1px solid ${C[100]}`,background:i%2?"#fafafa":"#fff"}}>
                  <td style={{padding:"9px 14px",fontWeight:700}}>{c.orden}</td>
                  <td style={{padding:"9px 14px",fontWeight:700,color:C[700],fontSize:16}}>{c.hora_corte}</td>
                  <td style={{padding:"9px 14px"}}>{c.capacidad_corte} pedidos</td>
                  <td style={{padding:"9px 14px"}}><button onClick={()=>eliminar(c.id)} style={{background:"none",border:"none",cursor:"pointer",color:"#dc2626",fontSize:18,padding:0}}>×</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <div style={{display:"flex",justifyContent:"flex-end"}}><Btn variant="secondary" onClick={onClose}>Cerrar</Btn></div>
      </div>
    </Modal>
  );
}

// ── GESTIÓN ASESORES ───────────────────────────────────────────────────────────
function GestionAsesores({showToast}) {
  const [asesores, setAsesores] = useState([]);
  const [modNuevo, setModNuevo] = useState(false);
  const [editando, setEditando] = useState(null);
  const vacio = {codigo:'',nombre:'',email:''};
  const [form, setForm] = useState(vacio);
  const f = k => v => setForm(p=>({...p,[k]:v}));
  const [carg, setCarg] = useState(false);
  const fileRef = useRef(null);

  const cargar = async () => {
    const {data} = await supabase.from('asesores').select('*').order('codigo');
    setAsesores(data||[]);
  };
  useEffect(()=>{cargar();},[]);

  const guardar = async () => {
    if(!form.codigo||!form.nombre||!form.email){showToast("Completa todos los campos","error");return;}
    setCarg(true);
    const datos = {codigo:form.codigo.trim(),nombre:form.nombre.trim(),email:form.email.trim()};
    const {error} = editando
      ? await supabase.from('asesores').update(datos).eq('id',editando)
      : await supabase.from('asesores').upsert(datos,{onConflict:'codigo'});
    if(error)showToast("Error: "+error.message,"error");
    else{showToast("✓ Asesor guardado","success");setModNuevo(false);setEditando(null);setForm(vacio);cargar();}
    setCarg(false);
  };

  const eliminar = async (id,nombre) => {
    if(!window.confirm(`¿Eliminar asesor "${nombre}"?`))return;
    await supabase.from('asesores').delete().eq('id',id);
    showToast("Asesor eliminado","info");cargar();
  };

  const cargarCSV = (file) => {
    const reader = new FileReader();
    reader.onload = async (e) => {
      const text = e.target.result;
      const lines = text.trim().split(/\r?\n/).filter(l=>l.trim());
      if(lines.length<2){showToast("Archivo vacío o solo tiene encabezado","error");return;}
      const sep = lines[0].includes(';')?';':',';
      const hdrs = lines[0].split(sep).map(h=>h.trim().replace(/"/g,'').toLowerCase());
      const iCod = hdrs.findIndex(h=>h.includes('codigo')||h.includes('código'));
      const iNom = hdrs.findIndex(h=>h.includes('nombre'));
      const iEml = hdrs.findIndex(h=>h.includes('email')||h.includes('correo'));
      if(iCod===-1||iNom===-1||iEml===-1){showToast("El CSV debe tener columnas: codigo, nombre, email","error");return;}
      const datos = lines.slice(1).map(l=>{
        const c=l.split(sep).map(x=>x.trim().replace(/^"|"$/g,''));
        return {codigo:c[iCod]||'',nombre:c[iNom]||'',email:c[iEml]||''};
      }).filter(r=>r.codigo&&r.nombre&&r.email);
      let ok=0;
      for(const d of datos){
        const {error}=await supabase.from('asesores').upsert(d,{onConflict:'codigo'});
        if(!error)ok++;
      }
      showToast(`✓ ${ok} asesor(es) importados`,"success");cargar();
    };
    reader.readAsText(file,'UTF-8');
  };

  return (
    <div>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20,flexWrap:"wrap",gap:10}}>
        <h2 style={{margin:0,fontWeight:900}}>👤 Asesores Comerciales</h2>
        <div style={{display:"flex",gap:8}}>
          <Btn variant="secondary" size="sm" onClick={()=>fileRef.current?.click()}>📤 Cargar CSV</Btn>
          <Btn onClick={()=>{setForm(vacio);setEditando(null);setModNuevo(true);}}>+ Nuevo Asesor</Btn>
        </div>
      </div>
      <input ref={fileRef} type="file" accept=".csv,.txt" style={{display:"none"}} onChange={e=>{if(e.target.files[0])cargarCSV(e.target.files[0]);}}/>
      <div style={{background:"#eff6ff",borderRadius:10,padding:"10px 16px",fontSize:12,color:"#1e40af",marginBottom:16}}>
        📌 El CSV debe tener estas columnas: <strong>codigo, nombre, email</strong> — separadas por coma o punto y coma.
      </div>
      {asesores.length===0&&<Card style={{textAlign:"center",padding:40,color:"#94a3b8"}}>No hay asesores registrados.</Card>}
      <Card style={{padding:0,overflow:"hidden"}}>
        <table style={{width:"100%",borderCollapse:"collapse",fontSize:13}}>
          <thead><tr style={{background:C[50]}}>{["Código","Nombre","Correo","Acciones"].map(h=><th key={h} style={{padding:"10px 16px",textAlign:"left",fontWeight:700,color:C[700],fontSize:11}}>{h}</th>)}</tr></thead>
          <tbody>
            {asesores.map((a,i)=>(
              <tr key={a.id} style={{borderTop:`1px solid ${C[100]}`,background:i%2?"#fafafa":"#fff"}}>
                <td style={{padding:"10px 16px",fontFamily:"monospace",fontWeight:700,color:C[700]}}>{a.codigo}</td>
                <td style={{padding:"10px 16px",fontWeight:600}}>{a.nombre}</td>
                <td style={{padding:"10px 16px",color:"#64748b"}}>{a.email}</td>
                <td style={{padding:"10px 16px"}}>
                  <div style={{display:"flex",gap:8}}>
                    <Btn size="sm" variant="secondary" onClick={()=>{setForm({...a});setEditando(a.id);setModNuevo(true);}}>✏️</Btn>
                    <Btn size="sm" variant="danger" onClick={()=>eliminar(a.id,a.nombre)}>×</Btn>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      {modNuevo&&(
        <Modal title={editando?"Editar Asesor":"Nuevo Asesor"} onClose={()=>{setModNuevo(false);setEditando(null);}}>
          <div style={{display:"flex",flexDirection:"column",gap:14}}>
            <Field label="Código del asesor *" value={form.codigo} onChange={f("codigo")} placeholder="34"/>
            <Field label="Nombre completo *" value={form.nombre} onChange={f("nombre")} placeholder="Juan Pérez"/>
            <Field label="Correo electrónico *" value={form.email} onChange={f("email")} placeholder="juan@empresa.com" type="email"/>
            <div style={{display:"flex",gap:10,justifyContent:"flex-end"}}>
              <Btn variant="secondary" onClick={()=>{setModNuevo(false);setEditando(null);}}>Cancelar</Btn>
              <Btn disabled={carg} onClick={guardar}>{carg?"Guardando...":"💾 Guardar"}</Btn>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ── GESTIÓN USUARIOS ───────────────────────────────────────────────────────────
function GestionUsuarios({showToast}) {
  const [usuarios, setUsuarios] = useState([]);
  const [mod, setMod] = useState(false);
  const vacio = {nombre:'',email:'',password:'',rol:'cartera',activo:true};
  const [form, setForm] = useState(vacio);
  const f = k => v => setForm(p=>({...p,[k]:v}));
  const [editId, setEditId] = useState(null);
  const [carg,   setCarg]  = useState(false);

  const cargar = async () => {
    const {data} = await supabase.from('usuarios_cartera').select('*').order('nombre');
    setUsuarios(data||[]);
  };
  useEffect(()=>{cargar();},[]);

  const guardar = async () => {
    if(!form.nombre||!form.email||(!editId&&!form.password)){showToast("Completa todos los campos","error");return;}
    setCarg(true);
    const datos = {nombre:form.nombre.trim(),email:form.email.trim(),rol:form.rol,activo:form.activo};
    if(form.password) datos.password = form.password;
    const {error} = editId
      ? await supabase.from('usuarios_cartera').update(datos).eq('id',editId)
      : await supabase.from('usuarios_cartera').insert({...datos,password:form.password});
    if(error)showToast("Error: "+error.message,"error");
    else{showToast("✓ Usuario guardado","success");setMod(false);setEditId(null);setForm(vacio);cargar();}
    setCarg(false);
  };

  return (
    <div>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20,flexWrap:"wrap",gap:10}}>
        <h2 style={{margin:0,fontWeight:900}}>👥 Usuarios</h2>
        <Btn onClick={()=>{setForm(vacio);setEditId(null);setMod(true);}}>+ Nuevo Usuario</Btn>
      </div>
      <Card style={{padding:0,overflow:"hidden"}}>
        <table style={{width:"100%",borderCollapse:"collapse",fontSize:13}}>
          <thead><tr style={{background:C[50]}}>{["Nombre","Correo","Rol","Estado","Acciones"].map(h=><th key={h} style={{padding:"10px 16px",textAlign:"left",fontWeight:700,color:C[700],fontSize:11}}>{h}</th>)}</tr></thead>
          <tbody>
            {usuarios.map((u,i)=>(
              <tr key={u.id} style={{borderTop:`1px solid ${C[100]}`,background:i%2?"#fafafa":"#fff"}}>
                <td style={{padding:"10px 16px",fontWeight:600}}>{u.nombre}</td>
                <td style={{padding:"10px 16px",color:"#64748b"}}>{u.email}</td>
                <td style={{padding:"10px 16px"}}><span style={{background:C[50],color:C[700],borderRadius:20,padding:"2px 10px",fontSize:11,fontWeight:700}}>{ROLES[u.rol]||u.rol}</span></td>
                <td style={{padding:"10px 16px"}}><span style={{color:u.activo?C[600]:"#dc2626",fontWeight:700}}>{u.activo?"Activo":"Inactivo"}</span></td>
                <td style={{padding:"10px 16px"}}>
                  <Btn size="sm" variant="secondary" onClick={()=>{setForm({...u,password:''});setEditId(u.id);setMod(true);}}>✏️ Editar</Btn>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      {mod&&(
        <Modal title={editId?"Editar Usuario":"Nuevo Usuario"} onClose={()=>{setMod(false);setEditId(null);}}>
          <div style={{display:"flex",flexDirection:"column",gap:14}}>
            <Field label="Nombre completo *" value={form.nombre} onChange={f("nombre")} placeholder="Juan Pérez"/>
            <Field label="Correo electrónico *" value={form.email} onChange={f("email")} placeholder="juan@empresa.com" type="email"/>
            <Field label={editId?"Nueva contraseña (dejar vacío para no cambiar)":"Contraseña *"} value={form.password} onChange={f("password")} placeholder="••••••••" type="password"/>
            <Field label="Rol *" value={form.rol} onChange={f("rol")} as="select" options={[
              {value:"admin",label:"Administrador"},{value:"cartera",label:"Cartera"},
              {value:"logistica",label:"Logística"},{value:"consultas",label:"Consultas"}
            ]}/>
            <div style={{display:"flex",alignItems:"center",gap:10,cursor:"pointer"}} onClick={()=>f("activo")(!form.activo)}>
              <div style={{width:20,height:20,borderRadius:5,border:`2px solid ${form.activo?C[600]:"#94a3b8"}`,background:form.activo?C[600]:"transparent",display:"flex",alignItems:"center",justifyContent:"center"}}>
                {form.activo&&<span style={{color:"#fff",fontSize:13,fontWeight:900}}>✓</span>}
              </div>
              <span style={{fontSize:13,fontWeight:600}}>Usuario activo</span>
            </div>
            <div style={{display:"flex",gap:10,justifyContent:"flex-end"}}>
              <Btn variant="secondary" onClick={()=>{setMod(false);setEditId(null);}}>Cancelar</Btn>
              <Btn disabled={carg} onClick={guardar}>{carg?"Guardando...":"💾 Guardar"}</Btn>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ── CARGAR CARTERA VENCIDA ─────────────────────────────────────────────────────
function CargarCarteraVencida({showToast}) {
  const [archivo,  setArchivo]  = useState('');
  const [preview,  setPreview]  = useState(null);
  const [carg,     setCarg]     = useState(false);
  const [resultado,setResultado]= useState(null);
  const fileRef = useRef(null);

  const parsearCSV = (text) => {
    const lines = text.trim().split(/\r?\n/).filter(l=>l.trim());
    if(lines.length<2) throw new Error("Archivo vacío");
    const sep = lines[0].includes(';')?';':',';
    const hdrs = lines[0].split(sep).map(h=>h.trim().replace(/"/g,'').toLowerCase());
    const iNit  = hdrs.findIndex(h=>h==='cliente'||h.includes('nit'));
    const iRaz  = hdrs.findIndex(h=>h.includes('razonsocial')||h.includes('razon'));
    const iDias = hdrs.findIndex(h=>h.includes('diasexcedio')||h.includes('dias'));
    const iFCor = hdrs.findIndex(h=>h.includes('fechacorte')||h.includes('corte'));
    if(iNit===-1||iDias===-1) throw new Error("No se encontraron columnas requeridas: Cliente (NIT) y DiasExcedio");

    const porNit = {};
    for(const line of lines.slice(1)) {
      const c = line.split(sep).map(x=>x.trim().replace(/^"|"$/g,''));
      const nit  = c[iNit]||'';
      const dias = parseInt(c[iDias])||0;
      const raz  = iRaz!==-1?c[iRaz]||'':'';
      const fcor = iFCor!==-1?c[iFCor]||'':'';
      if(!nit) continue;
      if(!porNit[nit]) porNit[nit]={nit,razon_social:raz,max_dias:dias,fecha_corte:fcor};
      else if(dias>porNit[nit].max_dias) porNit[nit].max_dias=dias;
    }
    return Object.values(porNit).map(r=>({
      nit: r.nit,
      razon_social: r.razon_social,
      tiene_vencidos: r.max_dias>0,
      dias_max_vencido: r.max_dias,
      fecha_corte: r.fecha_corte||new Date().toISOString().split('T')[0],
    }));
  };

  const leerArchivo = (file) => {
    setArchivo(file.name); setPreview(null); setResultado(null);
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const datos = parsearCSV(e.target.result);
        const vencidos = datos.filter(d=>d.tiene_vencidos).length;
        setPreview({total:datos.length, vencidos, alDia:datos.length-vencidos, datos});
      } catch(ex) { showToast("Error: "+ex.message,"error"); setArchivo(''); }
    };
    reader.onerror=()=>showToast("Error leyendo el archivo","error");
    reader.readAsText(file,'latin-1');
  };

  const aplicar = async () => {
    if(!preview) return;
    setCarg(true);
    try {
      // Delete all and replace
      await supabase.from('cartera_clientes').delete().neq('id','00000000-0000-0000-0000-000000000000');
      // Insert in chunks of 100
      const CHUNK=100;
      let ok=0;
      for(let i=0;i<preview.datos.length;i+=CHUNK){
        const chunk=preview.datos.slice(i,i+CHUNK);
        const {error}=await supabase.from('cartera_clientes').insert(chunk);
        if(!error) ok+=chunk.length;
      }
      setResultado({ok, total:preview.datos.length});
      showToast(`✓ ${ok} clientes actualizados en cartera`,"success");
      setPreview(null); setArchivo('');
    } catch(e){showToast("Error de conexión","error");}
    setCarg(false);
  };

  return (
    <div>
      <h2 style={{margin:"0 0 8px",fontWeight:900}}>📋 Cargar Estado de Cartera</h2>
      <p style={{margin:"0 0 20px",fontSize:13,color:"#64748b"}}>Sube el archivo de cartera vencida. Cada vez que lo subas reemplazará completamente el estado anterior.</p>

      <Card style={{marginBottom:16}}>
        <div style={{fontWeight:700,marginBottom:10,fontSize:13}}>Columnas requeridas en el archivo:</div>
        <div style={{fontSize:12,color:"#64748b",display:"flex",gap:16,flexWrap:"wrap"}}>
          <span>✓ <strong>Cliente</strong> — NIT del cliente</span>
          <span>✓ <strong>DiasExcedio</strong> — días vencidos (mayor a 0 = vencido)</span>
          <span>○ RazonSocial, FechaCorte — opcionales</span>
        </div>
      </Card>

      {!preview&&!resultado&&(
        <div style={{border:`2px dashed ${C[300]}`,borderRadius:14,padding:"32px 20px",textAlign:"center",cursor:"pointer",background:"#fafafa"}}
          onClick={()=>fileRef.current?.click()} onDragOver={e=>e.preventDefault()}
          onDrop={e=>{e.preventDefault();if(e.dataTransfer.files[0])leerArchivo(e.dataTransfer.files[0]);}}>
          <div style={{fontSize:40,marginBottom:8}}>📂</div>
          <div style={{color:"#64748b",fontWeight:600}}>{archivo||"Clic o arrastra el archivo CSV aquí"}</div>
        </div>
      )}
      <input ref={fileRef} type="file" accept=".csv,.txt" style={{display:"none"}} onChange={e=>{if(e.target.files[0])leerArchivo(e.target.files[0]);}}/>

      {preview&&(
        <div style={{display:"flex",flexDirection:"column",gap:16}}>
          <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:12}}>
            {[{l:"Total clientes",v:preview.total,c:C[600],bg:C[50]},{l:"Con cartera vencida",v:preview.vencidos,c:"#dc2626",bg:"#fef2f2"},{l:"Al día",v:preview.alDia,c:"#059669",bg:"#ecfdf5"}].map(s=>(
              <div key={s.l} style={{background:s.bg,borderRadius:10,padding:"14px 16px",textAlign:"center"}}>
                <div style={{fontSize:28,fontWeight:900,color:s.c}}>{s.v}</div>
                <div style={{fontSize:11,color:"#64748b",fontWeight:700,marginTop:4}}>{s.l}</div>
              </div>
            ))}
          </div>
          <div style={{background:"#fffbeb",border:"1px solid #fcd34d",borderRadius:10,padding:"10px 16px",fontSize:12,color:"#92400e"}}>
            ⚠️ Al confirmar se reemplazará completamente la base de cartera anterior con los {preview.total} clientes de este archivo.
          </div>
          <div style={{display:"flex",gap:10,justifyContent:"flex-end"}}>
            <Btn variant="secondary" onClick={()=>{setPreview(null);setArchivo('');}}>⬅ Cambiar archivo</Btn>
            <Btn disabled={carg} onClick={aplicar}>{carg?"Aplicando...":"✅ Confirmar y Reemplazar"}</Btn>
          </div>
        </div>
      )}

      {resultado&&(
        <Card style={{background:"#ecfdf5",border:"2px solid #86efac"}}>
          <div style={{fontWeight:800,color:"#059669",fontSize:15,marginBottom:8}}>✅ Cartera actualizada correctamente</div>
          <div style={{fontSize:13,color:"#334155"}}>{resultado.ok} de {resultado.total} clientes actualizados.</div>
          <Btn size="sm" variant="secondary" style={{marginTop:12}} onClick={()=>setResultado(null)}>Cargar otro archivo</Btn>
        </Card>
      )}
    </div>
  );
}

// ── CARGAR PEDIDOS ─────────────────────────────────────────────────────────────
function CargarPedidos({showToast,onCargado}) {
  const [archivo,   setArchivo]  = useState('');
  const [pedidos,   setPedidos]  = useState([]);
  const [errMsg,    setErrMsg]   = useState('');
  const [carg,      setCarg]     = useState(false);
  const [resultado, setResultado]= useState(null);
  const [cartera,   setCartera]  = useState({});
  const fileRef = useRef(null);

  // Cargar estado de cartera para clasificar
  useEffect(()=>{
    supabase.from('cartera_clientes').select('nit,tiene_vencidos').then(({data})=>{
      const mapa={};
      (data||[]).forEach(c=>{mapa[c.nit]={tiene_vencidos:c.tiene_vencidos};});
      setCartera(mapa);
    });
  },[]);

  const clasificar = (nit, plazo) => {
    const nitStr = String(nit||'').trim();
    if(cartera[nitStr]?.tiene_vencidos) return 'cartera_vencida';
    if(parseInt(plazo||0)>0) return 'preaprobado';
    return 'pendiente';
  };

  const leerArchivo = (file) => {
    setArchivo(file.name); setPedidos([]); setErrMsg(''); setResultado(null);
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        let wb;
        // Try Excel first, then CSV
        if(file.name.endsWith('.xlsx')||file.name.endsWith('.xls')) {
          const data = new Uint8Array(e.target.result);
          wb = XLSX.read(data,{type:'array'});
        } else {
          wb = XLSX.read(e.target.result,{type:'string'});
        }
        const ws = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(ws,{header:1,defval:''});
        if(rows.length<2){setErrMsg("El archivo está vacío o solo tiene encabezado");return;}

        const hdrs = rows[0].map(h=>String(h||'').trim().toLowerCase().replace(/\s+/g,'_'));
        const col = (...names)=>{for(const n of names){const i=hdrs.findIndex(h=>h.includes(n));if(i!==-1)return i;}return -1;};

        const iCia   = col('cia');
        const iFech  = col('fecha');
        const iPed   = col('pedido');
        const iNit   = col('nit');
        const iCli   = col('nombre_cliente','cliente');
        const iDir   = col('direccion','dirección');
        const iDane  = col('sector_dane');
        const iValDec= col('valor_declarado');
        const iCodMsg= col('codigo_mensaje','código_mensaje');
        const iPlazo = col('plazo');
        const iObs   = col('observacion','observación');
        const iVend  = col('vendedor');
        const iOrig  = col('origen');
        const iDaneO = col('dane_origen');
        const iCBRef = col('cia_bod_ref');
        const iBod   = col('bodega');
        const iRef   = col('referencia');
        const iDesc  = col('descripcion_ref','descripción');
        const iPrecio= col('precio');
        const iCant  = col('cantidad_pedida','cantidad');
        const iLios  = col('lios','líos');
        const iVTotal= col('valor_total');

        if(iPed===-1) {setErrMsg("No se encontró la columna 'Pedido'");return;}

        // Group rows by pedido
        const grupos = {};
        for(const row of rows.slice(1)) {
          const numPed = String(row[iPed]||'').trim();
          if(!numPed) continue;
          if(!grupos[numPed]) {
            grupos[numPed]={
              numero_pedido:numPed,
              cia:          String(row[iCia]||'').trim(),
              fecha_pedido: isFecha(row[iFech]),
              nit:          String(row[iNit]||'').trim(),
              cliente:      String(row[iCli]||'').trim(),
              direccion:    String(row[iDir]||'').trim(),
              sector_dane:  String(row[iDane]||'').trim(),
              codigo_mensaje:String(row[iCodMsg]||'').trim(),
              plazo:        parseInt(row[iPlazo]||0)||0,
              observacion:  String(row[iObs]||'').trim(),
              vendedor:     String(row[iVend]||'').trim(),
              origen:       String(row[iOrig]||'').trim(),
              dane_origen:  String(row[iDaneO]||'').trim(),
              valor_total:  0,
              lineas:[],
            };
          }
          const linea={
            cia_bod_ref:String(row[iCBRef]||'').trim(),
            bodega:     String(row[iBod]||'').trim(),
            referencia: String(row[iRef]||'').trim(),
            descripcion:String(row[iDesc]||'').trim(),
            precio:     parseFloat(String(row[iPrecio]||'0').replace(/[^0-9.-]/g,''))||0,
            cantidad_pedida:parseInt(row[iCant]||0)||0,
            lios:       parseInt(row[iLios]||0)||0,
            valor_total:parseFloat(String(row[iVTotal]||'0').replace(/[^0-9.-]/g,''))||0,
          };
          grupos[numPed].lineas.push(linea);
          grupos[numPed].valor_total += linea.valor_total;
        }

        const lista = Object.values(grupos).map(p=>({
          ...p,
          estado_cartera: clasificar(p.nit, p.plazo),
        }));

        if(lista.length===0){setErrMsg("No se encontraron pedidos en el archivo");return;}
        setPedidos(lista);
      } catch(ex){setErrMsg("Error leyendo el archivo: "+ex.message);}
    };
    reader.onerror=()=>setErrMsg("Error leyendo el archivo");
    if(file.name.endsWith('.xlsx')||file.name.endsWith('.xls'))
      reader.readAsArrayBuffer(file);
    else
      reader.readAsText(file,'latin-1');
  };

  const isFecha = (val) => {
    if(!val) return null;
    if(val instanceof Date) return val.toISOString().split('T')[0];
    if(typeof val==='number') {
      const d = new Date((val-25569)*86400*1000);
      return d.toISOString().split('T')[0];
    }
    const s = String(val).trim();
    if(s.match(/^\d{4}-\d{2}-\d{2}/)) return s.slice(0,10);
    return s;
  };

  const confirmar = async () => {
    if(!pedidos.length) return;
    setCarg(true);
    let ok=0, errores=0;
    for(const p of pedidos) {
      const {lineas,...pedData} = p;
      const {data:inserted,error} = await supabase.from('pedidos_cartera').insert(pedData).select().single();
      if(error||!inserted){errores++;continue;}
      if(lineas.length>0){
        await supabase.from('pedidos_cartera_detalle').insert(lineas.map(l=>({...l,pedido_id:inserted.id})));
      }
      ok++;
    }
    setCarg(false);
    setResultado({ok,errores,total:pedidos.length});
    showToast(`✓ ${ok} pedido(s) cargados`,"success");
    if(ok>0 && onCargado) onCargado();
  };

  const resumen = {
    total:pedidos.length,
    vencida:pedidos.filter(p=>p.estado_cartera==='cartera_vencida').length,
    preaprobado:pedidos.filter(p=>p.estado_cartera==='preaprobado').length,
    pendiente:pedidos.filter(p=>p.estado_cartera==='pendiente').length,
  };

  return (
    <div>
      <h2 style={{margin:"0 0 8px",fontWeight:900}}>📤 Cargar Pedidos</h2>
      <p style={{margin:"0 0 20px",fontSize:13,color:"#64748b"}}>Sube el archivo de pedidos del día en formato Excel (.xlsx) o CSV. El sistema los clasificará automáticamente según el estado de cartera.</p>

      {!pedidos.length&&!resultado&&(
        <>
          <div style={{border:`2px dashed ${C[300]}`,borderRadius:14,padding:"40px 20px",textAlign:"center",cursor:"pointer",background:"#fafafa"}}
            onClick={()=>fileRef.current?.click()} onDragOver={e=>e.preventDefault()}
            onDrop={e=>{e.preventDefault();if(e.dataTransfer.files[0])leerArchivo(e.dataTransfer.files[0]);}}>
            <div style={{fontSize:44,marginBottom:8}}>📊</div>
            <div style={{color:"#64748b",fontWeight:600,fontSize:15}}>{archivo||"Clic o arrastra el archivo aquí"}</div>
            <div style={{color:"#94a3b8",fontSize:12,marginTop:6}}>Acepta archivos .xlsx, .xls y .csv</div>
          </div>
          {errMsg&&<div style={{background:"#fef2f2",borderRadius:10,padding:"10px 16px",fontSize:13,color:"#dc2626",fontWeight:600,marginTop:12}}>⚠️ {errMsg}</div>}
        </>
      )}
      <input ref={fileRef} type="file" accept=".csv,.xlsx,.xls" style={{display:"none"}} onChange={e=>{if(e.target.files[0])leerArchivo(e.target.files[0]);}}/>

      {pedidos.length>0&&!resultado&&(
        <div style={{display:"flex",flexDirection:"column",gap:16}}>
          <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:12}}>
            {[{l:"Total pedidos",v:resumen.total,c:C[600],bg:C[50]},{l:"Cartera Vencida",v:resumen.vencida,c:"#dc2626",bg:"#fef2f2"},{l:"Preaprobados",v:resumen.preaprobado,c:"#059669",bg:"#ecfdf5"},{l:"Pendientes",v:resumen.pendiente,c:"#d97706",bg:"#fffbeb"}].map(s=>(
              <div key={s.l} style={{background:s.bg,borderRadius:10,padding:"12px 14px",textAlign:"center"}}>
                <div style={{fontSize:26,fontWeight:900,color:s.c}}>{s.v}</div>
                <div style={{fontSize:11,color:"#64748b",fontWeight:700,marginTop:3}}>{s.l}</div>
              </div>
            ))}
          </div>
          <Card style={{padding:0,overflow:"hidden",maxHeight:320,overflowY:"auto"}}>
            <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
              <thead style={{position:"sticky",top:0,background:C[50]}}>
                <tr>{["Pedido","NIT","Cliente","Valor","Plazo","Asesor","Sede Origen","Estado"].map(h=><th key={h} style={{padding:"9px 12px",textAlign:"left",fontWeight:700,color:C[700],fontSize:11,whiteSpace:"nowrap"}}>{h}</th>)}</tr>
              </thead>
              <tbody>
                {pedidos.map((p,i)=>(
                  <tr key={p.numero_pedido} style={{borderTop:`1px solid ${C[100]}`,background:i%2?"#fafafa":"#fff"}}>
                    <td style={{padding:"8px 12px",fontFamily:"monospace",fontWeight:700,fontSize:11}}>{p.numero_pedido}</td>
                    <td style={{padding:"8px 12px",fontFamily:"monospace",fontSize:11}}>{p.nit}</td>
                    <td style={{padding:"8px 12px",maxWidth:140,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{p.cliente}</td>
                    <td style={{padding:"8px 12px",fontWeight:700}}>{fCOP(p.valor_total)}</td>
                    <td style={{padding:"8px 12px",textAlign:"center"}}>{p.plazo} días</td>
                    <td style={{padding:"8px 12px"}}>{p.vendedor}</td>
                    <td style={{padding:"8px 12px",fontSize:11,color:"#64748b"}}>{p.origen?.split('-').pop()||'—'}</td>
                    <td style={{padding:"8px 12px"}}><BadgeEstado estado={p.estado_cartera}/></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
          <div style={{display:"flex",gap:10,justifyContent:"flex-end"}}>
            <Btn variant="secondary" onClick={()=>{setPedidos([]);setArchivo('');setErrMsg('');}}>⬅ Cambiar archivo</Btn>
            <Btn disabled={carg} onClick={confirmar}>{carg?"Cargando...":"✅ Confirmar Carga"}</Btn>
          </div>
        </div>
      )}

      {resultado&&(
        <Card style={{background:"#ecfdf5",border:"2px solid #86efac"}}>
          <div style={{fontWeight:800,color:"#059669",fontSize:15,marginBottom:8}}>✅ Pedidos cargados correctamente</div>
          <div style={{fontSize:13,color:"#334155",display:"flex",flexDirection:"column",gap:4}}>
            <span>✓ <strong>{resultado.ok}</strong> pedido(s) cargados</span>
            {resultado.errores>0&&<span>✗ <strong>{resultado.errores}</strong> error(es)</span>}
          </div>
          <div style={{display:"flex",gap:10,marginTop:12}}>
            <Btn size="sm" variant="secondary" onClick={()=>setResultado(null)}>Cargar otro archivo</Btn>
          </div>
        </Card>
      )}
    </div>
  );
}

// ── GESTIÓN PEDIDOS (CARTERA) ──────────────────────────────────────────────────
function GestionPedidos({user, showToast}) {
  const [pedidos,    setPedidos]    = useState([]);
  const [filtroEst,  setFiltroEst]  = useState('todos');
  const [busq,       setBusq]       = useState('');
  const [seleccion,  setSeleccion]  = useState(new Set());
  const [modRechazar,setModRechazar]= useState(null);
  const [carg,       setCarg]       = useState(false);
  const [aprobando,  setAprobando]  = useState(false);

  const cargar = async () => {
    setCarg(true);
    const {data} = await supabase.from('pedidos_cartera').select('*')
      .in('estado_cartera',['pendiente','preaprobado','cartera_vencida','aprobado','rechazado'])
      .order('created_at',{ascending:false});
    setPedidos(data||[]);
    setSeleccion(new Set());
    setCarg(false);
  };
  useEffect(()=>{cargar();},[]);

  const filtrados = pedidos.filter(p=>{
    if(filtroEst!=='todos'&&p.estado_cartera!==filtroEst) return false;
    if(busq){
      const q=busq.toLowerCase();
      return p.numero_pedido?.toLowerCase().includes(q)||p.cliente?.toLowerCase().includes(q)||p.nit?.toLowerCase().includes(q)||p.vendedor?.toLowerCase().includes(q);
    }
    return true;
  });

  const pendientesAprobacion = filtrados.filter(p=>['pendiente','preaprobado','cartera_vencida'].includes(p.estado_cartera));

  const toggleSel = (id) => {
    const s=new Set(seleccion);
    s.has(id)?s.delete(id):s.add(id);
    setSeleccion(s);
  };
  const selTodos = () => {
    if(seleccion.size===pendientesAprobacion.length) setSeleccion(new Set());
    else setSeleccion(new Set(pendientesAprobacion.map(p=>p.id)));
  };

  const aprobarPedido = async (id) => {
    const pedido = pedidos.find(p=>p.id===id);
    if(!pedido) return {ok:false};
    const ahora = new Date().toISOString();
    const corte = await asignarCorte(pedido.dane_origen);
    const upd = { estado_cartera:'aprobado', fecha_aprobacion:ahora, aprobado_por:user.id, estado_impresion:'no_impreso' };
    if(corte){upd.corte_id=corte.corteId;upd.fecha_corte=corte.fechaCorte;}
    await supabase.from('pedidos_cartera').update(upd).eq('id',id);
    await supabase.from('historial_cartera').insert({pedido_id:id,decision:'aprobado',usuario_id:user.id,motivo:'Aprobado por cartera'});
    return {ok:true, sinCorte:!corte};
  };

  const aprobarUno = async (id) => {
    setAprobando(true);
    const {sinCorte} = await aprobarPedido(id);
    setAprobando(false);
    showToast("✓ Pedido aprobado"+(sinCorte?" · Sin sede configurada (verificar DANE Origen)":""),"success");
    cargar();
  };

  const aprobarSeleccionados = async () => {
    if(!seleccion.size){showToast("Selecciona al menos un pedido","error");return;}
    setAprobando(true);
    let ok=0; let sinCorte=0;
    for(const id of seleccion){
      const res = await aprobarPedido(id);
      if(res.ok){ ok++; if(res.sinCorte) sinCorte++; }
    }
    setAprobando(false);
    let msg=`✓ ${ok} pedido(s) aprobado(s)`;
    if(sinCorte>0) msg+=` · ${sinCorte} sin sede configurada (verificar DANE Origen)`;
    showToast(msg,"success");
    cargar();
  };

  const reactivar = async (id) => {
    if(!window.confirm("¿Reactivar este pedido? Volverá a estado Pendiente para revisión.")) return;
    await supabase.from('pedidos_cartera').update({estado_cartera:'pendiente',motivo_rechazo:null}).eq('id',id);
    await supabase.from('historial_cartera').insert({pedido_id:id,decision:'reactivado',usuario_id:user.id,motivo:'Reactivado desde rechazado'});
    showToast("↺ Pedido reactivado · Ahora está Pendiente","success");
    cargar();
  };

  const rechazar = async (pedidoId, motivo) => {
    const pedido = pedidos.find(p=>p.id===pedidoId);
    if(!pedido) return;
    // Buscar email del asesor
    let emailAsesor='';
    if(pedido.vendedor){
      const codVend = pedido.vendedor.trim();
      const codNorm = codVend.replace(/^0+/,'')||'0'; // "01" -> "1", ignora ceros a la izquierda
      const {data:asesoresMatch} = await supabase.from('asesores').select('email,codigo');
      const asesor = (asesoresMatch||[]).find(a=>{
        const c = String(a.codigo||'').trim();
        return c===codVend || (c.replace(/^0+/,'')||'0')===codNorm;
      });
      if(asesor) emailAsesor=asesor.email;
    }
    await supabase.from('pedidos_cartera').update({estado_cartera:'rechazado',motivo_rechazo:motivo}).eq('id',pedidoId);
    await supabase.from('historial_cartera').insert({pedido_id:pedidoId,decision:'rechazado',usuario_id:user.id,motivo});
    if(emailAsesor) await enviarCorreoRechazo(pedido,motivo,emailAsesor);
    showToast("Pedido rechazado"+(emailAsesor?` · Correo enviado a ${emailAsesor}`:""),"info");
    setModRechazar(null);
    cargar();
  };

  const tabs=[
    {k:'todos',l:'Todos'},
    {k:'preaprobado',l:'Preaprobados'},
    {k:'pendiente',l:'Pendientes'},
    {k:'cartera_vencida',l:'Cartera Vencida'},
    {k:'aprobado',l:'Aprobados'},
    {k:'rechazado',l:'Rechazados'},
  ];

  const conteos={};
  pedidos.forEach(p=>{conteos[p.estado_cartera]=(conteos[p.estado_cartera]||0)+1;});

  return (
    <div>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20,flexWrap:"wrap",gap:10}}>
        <h2 style={{margin:0,fontWeight:900}}>✅ Gestión de Pedidos</h2>
        <Btn variant="secondary" onClick={cargar}>🔄 Actualizar</Btn>
      </div>

      {/* Tabs de estado */}
      <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:16}}>
        {tabs.map(t=>{
          const cnt = t.k==='todos'?pedidos.length:(conteos[t.k]||0);
          const est = ESTADOS_CARTERA[t.k];
          return (
            <button key={t.k} onClick={()=>setFiltroEst(t.k)} style={{padding:"7px 14px",borderRadius:20,border:"none",cursor:"pointer",fontWeight:700,fontSize:12,fontFamily:"inherit",background:filtroEst===t.k?(est?.bg||C[50]):"#f1f5f9",color:filtroEst===t.k?(est?.color||C[700]):"#64748b",boxShadow:filtroEst===t.k?"0 2px 8px #0002":"none"}}>
              {t.l} {cnt>0&&<span style={{background:"rgba(0,0,0,0.1)",borderRadius:10,padding:"1px 6px",fontSize:10,marginLeft:4}}>{cnt}</span>}
            </button>
          );
        })}
      </div>

      {/* Barra de búsqueda y acciones */}
      <Card style={{padding:12,marginBottom:16}}>
        <div style={{display:"flex",gap:10,flexWrap:"wrap",alignItems:"center"}}>
          <input value={busq} onChange={e=>setBusq(e.target.value)} placeholder="🔍 Buscar por pedido, NIT, cliente o asesor..."
            style={{flex:1,minWidth:200,border:`1.5px solid ${C[200]}`,borderRadius:9,padding:"9px 13px",fontSize:13,fontFamily:"inherit",outline:"none",background:"#fafafa"}}/>
          {seleccion.size>0&&(
            <Btn onClick={aprobarSeleccionados} disabled={aprobando} variant="success">
              {aprobando?"Aprobando...":"✅ Aprobar seleccionados ("+seleccion.size+")"}
            </Btn>
          )}
        </div>
      </Card>

      {carg&&<div style={{textAlign:"center",padding:40,color:"#94a3b8"}}>Cargando pedidos...</div>}

      {!carg&&filtrados.length===0&&<Card style={{textAlign:"center",padding:40,color:"#94a3b8"}}>No hay pedidos con el filtro seleccionado.</Card>}

      {!carg&&filtrados.length>0&&(
        <Card style={{padding:0,overflow:"hidden"}}>
          <div style={{overflowX:"auto"}}>
            <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
              <thead style={{background:C[50]}}>
                <tr>
                  <th style={{padding:"10px 12px",width:36}}>
                    {pendientesAprobacion.length>0&&(
                      <input type="checkbox" checked={seleccion.size===pendientesAprobacion.length&&pendientesAprobacion.length>0}
                        onChange={selTodos} style={{cursor:"pointer",width:15,height:15}}/>
                    )}
                  </th>
                  {["Pedido","NIT","Cliente","Valor Total","Plazo","Asesor","Sede Origen","Estado","Corte Asignado","Acciones"].map(h=>(
                    <th key={h} style={{padding:"10px 12px",textAlign:"left",fontWeight:700,color:C[700],fontSize:11,whiteSpace:"nowrap"}}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtrados.map((p,i)=>{
                  const esPendiente = ['pendiente','preaprobado','cartera_vencida'].includes(p.estado_cartera);
                  return (
                    <tr key={p.id} style={{borderTop:`1px solid ${C[100]}`,background:seleccion.has(p.id)?`${C[100]}`:i%2?"#fafafa":"#fff"}}>
                      <td style={{padding:"10px 12px"}}>
                        {esPendiente&&<input type="checkbox" checked={seleccion.has(p.id)} onChange={()=>toggleSel(p.id)} style={{cursor:"pointer",width:15,height:15}}/>}
                      </td>
                      <td style={{padding:"10px 12px",fontFamily:"monospace",fontWeight:700,color:C[700],fontSize:11}}>{p.numero_pedido}</td>
                      <td style={{padding:"10px 12px",fontFamily:"monospace",fontSize:11}}>{p.nit}</td>
                      <td style={{padding:"10px 12px",maxWidth:150,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",fontWeight:600}}>{p.cliente}</td>
                      <td style={{padding:"10px 12px",fontWeight:700}}>{fCOP(p.valor_total)}</td>
                      <td style={{padding:"10px 12px",textAlign:"center"}}>{p.plazo} días</td>
                      <td style={{padding:"10px 12px"}}>{p.vendedor||'—'}</td>
                      <td style={{padding:"10px 12px",fontSize:11,color:"#64748b"}}>{p.origen?.split('-').pop()||'—'}</td>
                      <td style={{padding:"10px 12px"}}><BadgeEstado estado={p.estado_cartera}/></td>
                      <td style={{padding:"10px 12px",fontSize:11,color:"#64748b"}}>
                        {p.fecha_corte?<><div style={{fontWeight:600,color:C[700]}}>{fFecha(p.fecha_corte)}</div><div>{new Date(p.fecha_corte).toLocaleTimeString('es-CO',{hour:'2-digit',minute:'2-digit'})}</div></>:'—'}
                      </td>
                      <td style={{padding:"10px 12px",display:"flex",gap:6,flexWrap:"wrap"}}>
                        {esPendiente&&<Btn size="sm" variant="success" disabled={aprobando} onClick={()=>aprobarUno(p.id)}>✓ Aprobar</Btn>}
                        {esPendiente&&<Btn size="sm" variant="danger" onClick={()=>setModRechazar(p)}>✗ Rechazar</Btn>}
                        {p.estado_cartera==='rechazado'&&<Btn size="sm" variant="secondary" onClick={()=>reactivar(p.id)}>↺ Reactivar</Btn>}
                        {p.estado_cartera==='rechazado'&&p.motivo_rechazo&&<span style={{fontSize:10,color:"#94a3b8",fontStyle:"italic"}}>{p.motivo_rechazo.slice(0,30)}...</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {modRechazar&&(
        <ModalRechazar pedido={modRechazar} onRechazar={rechazar} onClose={()=>setModRechazar(null)}/>
      )}
    </div>
  );
}

function ModalRechazar({pedido, onRechazar, onClose}) {
  const [motivo, setMotivo] = useState('');
  const [carg,   setCarg]   = useState(false);
  const confirmar = async () => {
    if(!motivo.trim()){return;}
    setCarg(true);
    await onRechazar(pedido.id, motivo.trim());
    setCarg(false);
  };
  return (
    <Modal title="Rechazar Pedido" onClose={onClose}>
      <div style={{display:"flex",flexDirection:"column",gap:14}}>
        <div style={{background:"#fef2f2",borderRadius:10,padding:14,fontSize:13}}>
          <div style={{fontWeight:700,color:"#dc2626",marginBottom:6}}>Pedido: {pedido.numero_pedido}</div>
          <div style={{color:"#334155"}}>{pedido.cliente} — {pedido.nit}</div>
          <div style={{color:"#64748b",marginTop:4}}>Valor: {fCOP(pedido.valor_total)} · Asesor: {pedido.vendedor||'—'}</div>
        </div>
        <Field label="Motivo del rechazo *" value={motivo} onChange={setMotivo} as="textarea"
          placeholder="Explica el motivo del rechazo para notificar al asesor..."/>
        {!motivo.trim()&&<div style={{fontSize:12,color:"#dc2626"}}>El motivo es obligatorio para rechazar un pedido.</div>}
        <div style={{background:"#eff6ff",borderRadius:9,padding:"10px 14px",fontSize:12,color:"#1e40af"}}>
          📧 Se enviará un correo automático al asesor notificando el rechazo con el motivo.
        </div>
        <div style={{display:"flex",gap:10,justifyContent:"flex-end"}}>
          <Btn variant="secondary" onClick={onClose}>Cancelar</Btn>
          <Btn variant="danger" disabled={!motivo.trim()||carg} onClick={confirmar}>{carg?"Rechazando...":"✗ Confirmar Rechazo"}</Btn>
        </div>
      </div>
    </Modal>
  );
}

// ── MÓDULO LOGÍSTICA ───────────────────────────────────────────────────────────
function ModuloLogistica({showToast}) {
  const [sedes,   setSedes]   = useState([]);
  const [cortes,  setCortes]  = useState([]);
  const [filtroSede, setFiltroSede] = useState('');
  const [filtroFecha,setFiltroFecha]= useState(new Date().toISOString().split('T')[0]);
  const [filtroImp,  setFiltroImp]  = useState('no_impreso');
  const [pedidos,    setPedidos]    = useState([]);
  const [transmitiendo,setTransmitiendo]=useState(false);

  useEffect(()=>{
    supabase.from('sedes').select('*').order('nombre').then(({data})=>setSedes(data||[]));
  },[]);

  const cargar = async () => {
    let q = supabase.from('cortes_programados').select('*, sedes(nombre,municipio)')
      .eq('fecha',filtroFecha).order('hora_corte');
    if(filtroSede) q=q.eq('sede_id',filtroSede);
    const {data:cortesData} = await q;
    setCortes(cortesData||[]);

    // Load pedidos
    let qp = supabase.from('pedidos_cartera').select('*, pedidos_cartera_detalle(*)')
      .eq('estado_cartera','aprobado').order('fecha_corte');
    if(filtroFecha) qp=qp.gte('fecha_corte',filtroFecha+'T00:00:00').lte('fecha_corte',filtroFecha+'T23:59:59');
    if(filtroSede){
      // Get corte ids for this sede
      const ids=(cortesData||[]).map(c=>c.id);
      if(ids.length) qp=qp.in('corte_id',ids);
    }
    if(filtroImp==='no_impreso') qp=qp.or('estado_impresion.eq.no_impreso,estado_impresion.is.null');
    else if(filtroImp!=='todos') qp=qp.eq('estado_impresion',filtroImp);
    const {data:peds}=await qp;
    setPedidos(peds||[]);
  };
  useEffect(()=>{cargar();},[filtroSede,filtroFecha,filtroImp]);

  const transmitirCorte = async (corteId) => {
    setTransmitiendo(true);
    const ahora=new Date().toISOString();
    // Update pedidos in this corte
    await supabase.from('pedidos_cartera')
      .update({transmitido_tms:true,fecha_transmision:ahora})
      .eq('corte_id',corteId).eq('estado_cartera','aprobado');
    // Update corte status
    await supabase.from('cortes_programados')
      .update({estado:'transmitido',fecha_transmision:ahora}).eq('id',corteId);
    showToast("✓ Corte transmitido a logística","success");
    setTransmitiendo(false);
    cargar();
  };

  const imprimir = (pedidosImprimir) => {
    if(!pedidosImprimir.length){showToast("No hay pedidos para imprimir","error");return;}
    const win=window.open('','_blank');
    const html=pedidosImprimir.map((p,i)=>generarHTMLPedido(p,i<pedidosImprimir.length-1)).join('');
    win.document.write(`<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><title>Pedidos QTracking</title><style>
      *{box-sizing:border-box;margin:0;padding:0;}body{font-family:Arial,sans-serif;font-size:11px;color:#000;}
      .pagina{padding:16px;width:210mm;min-height:148mm;}
      .titulo{font-size:16px;font-weight:bold;margin-bottom:4px;}
      .subtitulo{font-size:12px;font-weight:bold;margin-bottom:12px;}
      table{width:100%;border-collapse:collapse;margin-bottom:8px;}
      th,td{border:1px solid #000;padding:4px 8px;text-align:left;font-size:10px;}
      th{background:#e5e7eb;font-weight:bold;}
      .enc-tabla td{border:none;padding:3px 0;}
      .enc-tabla td:first-child{font-weight:bold;width:140px;}
      .page-break{page-break-after:always;}
      @media print{body{-webkit-print-color-adjust:exact;}}
    </style></head><body>${html}</body></html>`);
    win.document.close();
    // Mark as printed
    pedidosImprimir.forEach(async p=>{
      await supabase.from('pedidos_cartera')
        .update({estado_impresion:'impreso',fecha_impresion:new Date().toISOString()}).eq('id',p.id);
    });
    win.print();
    cargar();
  };

  const generarHTMLPedido = (p, conSalto) => {
    const lineas=(p.pedidos_cartera_detalle||[]);
    const totalCant=lineas.reduce((a,l)=>a+l.cantidad_pedida,0);
    const totalLios=lineas.reduce((a,l)=>a+l.lios,0);
    const totalVal=lineas.reduce((a,l)=>a+l.valor_total,0);
    const fechaDoc = p.fecha_corte?fFecha(p.fecha_corte):fFecha(p.fecha_pedido);
    return `
    <div class="pagina${conSalto?' page-break':''}">
      <div class="titulo">SOMOS PRO</div>
      <div class="subtitulo">ORDEN DE PEDIDO</div>
      <table class="enc-tabla" style="margin-bottom:12px">
        <tr><td>Pedido No.</td><td><strong>${p.numero_pedido}</strong></td><td>Fecha</td><td><strong>${fechaDoc}</strong></td></tr>
        <tr><td>Compañía (Cia)</td><td>${p.cia||''}</td><td>Vendedor</td><td>${p.vendedor||''}</td></tr>
        <tr><td>Cliente</td><td colspan="3"><strong>${p.cliente||''}</strong></td></tr>
        <tr><td>Nit</td><td>${p.nit||''}</td><td>Sector Dane</td><td>${p.sector_dane||'(sin dato)'}</td></tr>
        <tr><td>Dirección</td><td colspan="3">${p.direccion||''}</td></tr>
        <tr><td>Código Mensaje</td><td>${p.codigo_mensaje||''}</td><td>Plazo (días)</td><td>${p.plazo||0}</td></tr>
        <tr><td>Valor Declarado</td><td colspan="3">${fCOP(p.valor_total)}</td></tr>
        <tr><td>Origen</td><td>${p.origen||''}</td><td>DANE Origen</td><td>${p.dane_origen||''}</td></tr>
        <tr><td>Observación</td><td colspan="3">${p.observacion||'(sin observaciones)'}</td></tr>
      </table>
      <table>
        <thead><tr><th>Referencia</th><th>Descripción</th><th>Bodega</th><th>Precio</th><th>Cant. Pedida</th><th>Líos</th><th>Valor Total</th></tr></thead>
        <tbody>
          ${lineas.map(l=>`<tr><td>${l.referencia||''}</td><td>${l.descripcion||''}</td><td>${l.bodega||''}</td><td>${fCOP(l.precio)}</td><td style="text-align:center">${l.cantidad_pedida}</td><td style="text-align:center">${l.lios}</td><td>${fCOP(l.valor_total)}</td></tr>`).join('')}
          <tr style="font-weight:bold;background:#f3f4f6"><td colspan="4">TOTALES</td><td style="text-align:center">${totalCant}</td><td style="text-align:center">${totalLios}</td><td>${fCOP(totalVal)}</td></tr>
        </tbody>
      </table>
    </div>`;
  };

  // Pedidos transmitidos y no impresos
  const pedidosTransmitidos = pedidos.filter(p=>p.transmitido_tms);

  return (
    <div>
      <h2 style={{margin:"0 0 20px",fontWeight:900}}>🖨️ Logística — Impresión de Pedidos</h2>

      {/* Filtros */}
      <Card style={{padding:14,marginBottom:16}}>
        <div style={{display:"flex",gap:12,flexWrap:"wrap",alignItems:"end"}}>
          <Field label="Fecha" value={filtroFecha} onChange={setFiltroFecha} type="date" style={{width:160}}/>
          <Field label="Sede" value={filtroSede} onChange={setFiltroSede} as="select" style={{flex:1,minWidth:180}}
            options={[{value:'',label:'Todas las sedes'},...sedes.map(s=>({value:s.id,label:s.nombre}))]}/>
          <Field label="Estado impresión" value={filtroImp} onChange={setFiltroImp} as="select" style={{width:180}}
            options={[{value:'todos',label:'Todos'},{value:'no_impreso',label:'No impresos'},{value:'impreso',label:'Ya impresos'}]}/>
        </div>
      </Card>

      {/* Cortes del día */}
      {cortes.length>0&&(
        <div style={{marginBottom:20}}>
          <div style={{fontWeight:700,fontSize:13,marginBottom:10,color:"#334155"}}>Cortes del {fFecha(filtroFecha)}</div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(220px,1fr))",gap:10}}>
            {cortes.map(c=>(
              <Card key={c.id} style={{borderLeft:`4px solid ${c.estado==='transmitido'?C[600]:c.estado==='cerrado'?"#d97706":"#94a3b8"}`}}>
                <div style={{fontWeight:700,fontSize:15,color:C[700]}}>{c.hora_corte}</div>
                <div style={{fontSize:12,color:"#64748b",marginTop:4}}>{c.sedes?.nombre}</div>
                <div style={{fontSize:12,marginTop:4}}>
                  <span style={{fontWeight:600}}>{c.pedidos_asignados}</span>/{c.capacidad_max} pedidos
                </div>
                <div style={{marginTop:8,display:"flex",gap:6,flexWrap:"wrap"}}>
                  <span style={{fontSize:11,fontWeight:700,padding:"2px 8px",borderRadius:12,background:c.estado==='transmitido'?C[100]:c.estado==='cerrado'?"#fffbeb":"#f1f5f9",color:c.estado==='transmitido'?C[700]:c.estado==='cerrado'?"#d97706":"#64748b"}}>{c.estado==='transmitido'?'✓ Transmitido':c.estado==='cerrado'?'Cerrado':'Abierto'}</span>
                  {c.estado==='abierto'&&<Btn size="sm" disabled={transmitiendo} onClick={()=>transmitirCorte(c.id)}>▶ Transmitir</Btn>}
                </div>
              </Card>
            ))}
          </div>
        </div>
      )}

      {/* Pedidos */}
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12,flexWrap:"wrap",gap:10}}>
        <div style={{fontWeight:700,fontSize:13,color:"#334155"}}>{pedidos.length} pedido(s) encontrado(s)</div>
        {pedidosTransmitidos.length>0&&filtroImp!=='impreso'&&(
          <Btn onClick={()=>imprimir(pedidosTransmitidos)} variant="success">🖨️ Imprimir todos ({pedidosTransmitidos.length})</Btn>
        )}
      </div>

      {pedidos.length===0&&<Card style={{textAlign:"center",padding:40,color:"#94a3b8"}}>No hay pedidos con los filtros seleccionados.</Card>}

      {pedidos.length>0&&(
        <Card style={{padding:0,overflow:"hidden"}}>
          <div style={{overflowX:"auto"}}>
            <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
              <thead style={{background:C[50]}}>
                <tr>{["Pedido","NIT","Cliente","Valor","Corte","Transmitido","Impresión","Acciones"].map(h=><th key={h} style={{padding:"10px 12px",textAlign:"left",fontWeight:700,color:C[700],fontSize:11,whiteSpace:"nowrap"}}>{h}</th>)}</tr>
              </thead>
              <tbody>
                {pedidos.map((p,i)=>(
                  <tr key={p.id} style={{borderTop:`1px solid ${C[100]}`,background:i%2?"#fafafa":"#fff"}}>
                    <td style={{padding:"10px 12px",fontFamily:"monospace",fontWeight:700,fontSize:11}}>{p.numero_pedido}</td>
                    <td style={{padding:"10px 12px",fontFamily:"monospace",fontSize:11}}>{p.nit}</td>
                    <td style={{padding:"10px 12px",maxWidth:150,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",fontWeight:600}}>{p.cliente}</td>
                    <td style={{padding:"10px 12px",fontWeight:700}}>{fCOP(p.valor_total)}</td>
                    <td style={{padding:"10px 12px",fontSize:11}}>{p.fecha_corte?<><div style={{fontWeight:600}}>{fFecha(p.fecha_corte)}</div><div style={{color:"#64748b"}}>{new Date(p.fecha_corte).toLocaleTimeString('es-CO',{hour:'2-digit',minute:'2-digit'})}</div></>:'—'}</td>
                    <td style={{padding:"10px 12px"}}>
                      {p.transmitido_tms?<span style={{color:C[600],fontWeight:700,fontSize:11}}>✓ {p.fecha_transmision?new Date(p.fecha_transmision).toLocaleTimeString('es-CO',{hour:'2-digit',minute:'2-digit'}):''}</span>:<span style={{color:"#94a3b8",fontSize:11}}>Pendiente</span>}
                    </td>
                    <td style={{padding:"10px 12px"}}>
                      <span style={{fontSize:11,fontWeight:700,color:p.estado_impresion==='impreso'?C[600]:"#94a3b8"}}>{p.estado_impresion==='impreso'?'✓ Impreso':'No impreso'}</span>
                      {p.fecha_impresion&&<div style={{fontSize:10,color:"#94a3b8"}}>{fFechaHora(p.fecha_impresion)}</div>}
                    </td>
                    <td style={{padding:"10px 12px"}}>
                      {p.transmitido_tms
                        ?<Btn size="sm" variant="secondary" onClick={()=>imprimir([p])}>🖨️ Imprimir</Btn>
                        :<span style={{fontSize:11,color:"#94a3b8"}}>Esperando transmisión</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}

// ── MÓDULO CONSULTAS ───────────────────────────────────────────────────────────
function ModuloConsultas({showToast}) {
  const [pedidos, setPedidos] = useState([]);
  const [busq,    setBusq]    = useState('');
  const [filtroEst,setFiltroEst]=useState('todos');

  const cargar = async () => {
    const {data}=await supabase.from('pedidos_cartera').select('*').order('created_at',{ascending:false}).limit(500);
    setPedidos(data||[]);
  };
  useEffect(()=>{cargar();},[]);

  const filtrados=pedidos.filter(p=>{
    if(filtroEst!=='todos'&&p.estado_cartera!==filtroEst) return false;
    if(busq){const q=busq.toLowerCase();return p.numero_pedido?.toLowerCase().includes(q)||p.cliente?.toLowerCase().includes(q)||p.nit?.toLowerCase().includes(q);}
    return true;
  });

  const getEstadoTexto = (p) => {
    if(p.estado_cartera==='rechazado') return {label:'Rechazado',color:'#dc2626'};
    if(p.estado_cartera==='aprobado'&&!p.transmitido_tms) return {label:'Aprobado — En espera de corte',color:'#d97706'};
    if(p.transmitido_tms&&p.estado_impresion==='no_impreso') return {label:'Transmitido a logística',color:C[600]};
    if(p.estado_impresion==='impreso') return {label:'Impreso — En picking',color:C[700]};
    return ESTADOS_CARTERA[p.estado_cartera]||{label:p.estado_cartera,color:'#64748b'};
  };

  return (
    <div>
      <h2 style={{margin:"0 0 20px",fontWeight:900}}>🔍 Estado de Pedidos</h2>
      <Card style={{padding:12,marginBottom:16}}>
        <div style={{display:"flex",gap:10,flexWrap:"wrap"}}>
          <input value={busq} onChange={e=>setBusq(e.target.value)} placeholder="🔍 Buscar por pedido, NIT o cliente..."
            style={{flex:1,minWidth:200,border:`1.5px solid ${C[200]}`,borderRadius:9,padding:"9px 13px",fontSize:13,fontFamily:"inherit",outline:"none",background:"#fafafa"}}/>
          <Field value={filtroEst} onChange={setFiltroEst} as="select" style={{width:200}}
            options={[{value:'todos',label:'Todos los estados'},{value:'pendiente',label:'Pendiente de aprobación'},{value:'preaprobado',label:'Preaprobado'},{value:'cartera_vencida',label:'Cartera Vencida'},{value:'aprobado',label:'Aprobado — En espera'},{value:'rechazado',label:'Rechazado'}]}/>
        </div>
      </Card>
      {filtrados.length===0&&<Card style={{textAlign:"center",padding:40,color:"#94a3b8"}}>No hay pedidos con el filtro seleccionado.</Card>}
      {filtrados.length>0&&(
        <Card style={{padding:0,overflow:"hidden"}}>
          <div style={{overflowX:"auto"}}>
            <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
              <thead style={{background:C[50]}}>
                <tr>{["Pedido","NIT","Cliente","Valor","Plazo","Fecha Pedido","Estado Actual","Corte / Transmisión"].map(h=><th key={h} style={{padding:"10px 12px",textAlign:"left",fontWeight:700,color:C[700],fontSize:11,whiteSpace:"nowrap"}}>{h}</th>)}</tr>
              </thead>
              <tbody>
                {filtrados.map((p,i)=>{
                  const est=getEstadoTexto(p);
                  return (
                    <tr key={p.id} style={{borderTop:`1px solid ${C[100]}`,background:i%2?"#fafafa":"#fff"}}>
                      <td style={{padding:"10px 12px",fontFamily:"monospace",fontWeight:700,color:C[700],fontSize:11}}>{p.numero_pedido}</td>
                      <td style={{padding:"10px 12px",fontFamily:"monospace",fontSize:11}}>{p.nit}</td>
                      <td style={{padding:"10px 12px",maxWidth:160,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",fontWeight:600}}>{p.cliente}</td>
                      <td style={{padding:"10px 12px",fontWeight:700}}>{fCOP(p.valor_total)}</td>
                      <td style={{padding:"10px 12px",textAlign:"center"}}>{p.plazo} días</td>
                      <td style={{padding:"10px 12px",fontSize:11}}>{fFecha(p.fecha_pedido)}</td>
                      <td style={{padding:"10px 12px"}}>
                        <span style={{background:est.color+'18',color:est.color,borderRadius:20,padding:"3px 10px",fontSize:11,fontWeight:700,whiteSpace:"nowrap"}}>{est.label}</span>
                        {p.motivo_rechazo&&<div style={{fontSize:10,color:"#94a3b8",marginTop:3,fontStyle:"italic"}}>{p.motivo_rechazo}</div>}
                      </td>
                      <td style={{padding:"10px 12px",fontSize:11}}>
                        {p.fecha_corte&&<div style={{color:C[700],fontWeight:600}}>{fFechaHora(p.fecha_corte)}</div>}
                        {p.fecha_transmision&&<div style={{color:"#059669",marginTop:2}}>Transmitido: {fFechaHora(p.fecha_transmision)}</div>}
                        {!p.fecha_corte&&'—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}

// ── APP PRINCIPAL ──────────────────────────────────────────────────────────────
export default function QtrackingCartera() {
  const [user,      setUser]      = useState(null);
  const [tab,       setTab]       = useState('');
  const [collapsed, setCollapsed] = useState(false);
  const [toast,     setToast]     = useState(null);

  const showToast = (msg, type='info') => setToast({msg, type});

  const setUserAndTab = (u) => {
    setUser(u);
    const defaultTabs = {admin:'sedes',cartera:'cargar_pedidos',logistica:'logistica',consultas:'consultas'};
    setTab(defaultTabs[u.rol]||'consultas');
  };

  const renderContent = () => {
    if(!user) return null;
    switch(tab) {
      case 'sedes':         return <GestionSedes showToast={showToast}/>;
      case 'asesores':      return <GestionAsesores showToast={showToast}/>;
      case 'usuarios':      return <GestionUsuarios showToast={showToast}/>;
      case 'cargar_cartera':return <CargarCarteraVencida showToast={showToast}/>;
      case 'cargar_pedidos':return <CargarPedidos showToast={showToast} onCargado={()=>setTab('gestion')}/>;
      case 'gestion':       return <GestionPedidos user={user} showToast={showToast}/>;
      case 'logistica':     return <ModuloLogistica showToast={showToast}/>;
      case 'consultas':     return <ModuloConsultas showToast={showToast}/>;
      default:              return <div style={{padding:40,color:"#94a3b8",textAlign:"center"}}>Selecciona una opción del menú</div>;
    }
  };

  if(!user) return (
    <>
      <Login onLogin={setUserAndTab} showToast={showToast}/>
      {toast&&<Toast msg={toast.msg} type={toast.type} onDone={()=>setToast(null)}/>}
    </>
  );

  return (
    <div style={{display:"flex",minHeight:"100vh"}}>
      <div className="no-print">
        <Sidebar user={user} activeTab={tab} setActiveTab={setTab}
          onLogout={()=>setUser(null)} collapsed={collapsed} setCollapsed={setCollapsed}/>
      </div>
      <main style={{flex:1,padding:24,overflowY:"auto",background:"#f0fdf4"}}>
        {renderContent()}
      </main>
      {toast&&<Toast msg={toast.msg} type={toast.type} onDone={()=>setToast(null)}/>}
    </div>
  );
}

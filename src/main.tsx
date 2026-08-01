import React, { FormEvent, useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Building2, ChevronLeft, ExternalLink, LogOut, MapPin, Navigation, Pencil, Plus, Search, ShieldCheck, Trash2, UserCog, Users } from 'lucide-react';
import './styles.css';

type Role = 'owner' | 'manager';
type Category = 'work_site' | 'reporting_point';
type PlaceType = 'station' | 'segment';
type User = { id:number; username:string; full_name:string; role:Role; is_active:boolean; must_change_password:boolean };
type Session = { token:string; user:User };
type LocationItem = { id:number; category:Category; place_type:PlaceType; name:string; km:string; waze_url:string; maps_url:string; coordinates:string; notes:string; created_at:string; updated_at:string };
type LocationDraft = Omit<LocationItem,'id'|'created_at'|'updated_at'>;

const API = (import.meta.env.VITE_API_URL || '/api').replace(/\/$/, '');
const blankLocation = (category:Category):LocationDraft => ({category,place_type:'segment',name:'',km:'',waze_url:'',maps_url:'',coordinates:'',notes:''});

async function request<T>(path:string, options:RequestInit={}, token?:string):Promise<T> {
  const response = await fetch(`${API}${path}`, { ...options, headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{ }),...(options.headers||{})} });
  if (!response.ok) {
    let message='אירעה שגיאה';
    try { const body=await response.json(); message=body.detail||message; } catch { /* ignore */ }
    throw new Error(message);
  }
  if (response.status===204) return undefined as T;
  return response.json();
}

function App() {
  const [session,setSession]=useState<Session|null>(()=>{try{return JSON.parse(localStorage.getItem('danel_location_session')||'null')}catch{return null}});
  const [items,setItems]=useState<LocationItem[]>([]);
  const [loading,setLoading]=useState(false);
  const [error,setError]=useState('');
  const [category,setCategory]=useState<Category>('work_site');
  const [placeType,setPlaceType]=useState<PlaceType|'all'>('all');
  const [query,setQuery]=useState('');
  const [editing,setEditing]=useState<LocationItem|LocationDraft|null>(null);
  const [usersOpen,setUsersOpen]=useState(false);

  useEffect(()=>{if(!session)return; setLoading(true); request<LocationItem[]>('/locations',{},session.token).then(setItems).catch(e=>{setError(e.message);logout()}).finally(()=>setLoading(false));},[session?.token]);
  const saveSession=(next:Session)=>{localStorage.setItem('danel_location_session',JSON.stringify(next));setSession(next)};
  const logout=()=>{localStorage.removeItem('danel_location_session');setSession(null);setItems([])};

  const filtered=useMemo(()=>items.filter(item=>item.category===category&&(placeType==='all'||item.place_type===placeType)&&`${item.name} ${item.km} ${item.notes}`.toLowerCase().includes(query.toLowerCase())),[items,category,placeType,query]);
  if(!session) return <Login onLogin={saveSession}/>;
  if(session.user.must_change_password) return <ChangePassword session={session} onChanged={saveSession} onLogout={logout}/>;

  async function saveLocation(draft:LocationDraft|LocationItem){
    setError('');
    try{
      if('id' in draft){const updated=await request<LocationItem>(`/locations/${draft.id}`,{method:'PUT',body:JSON.stringify(draft)},session.token);setItems(items.map(x=>x.id===updated.id?updated:x));}
      else {const created=await request<LocationItem>('/locations',{method:'POST',body:JSON.stringify(draft)},session.token);setItems([...items,created]);}
      setEditing(null);
    }catch(e){setError((e as Error).message)}
  }
  async function removeLocation(id:number){
    if(!confirm('למחוק את המיקום?'))return;
    try{await request(`/locations/${id}`,{method:'DELETE'},session.token);setItems(items.filter(x=>x.id!==id))}catch(e){setError((e as Error).message)}
  }

  return <main className="app-shell">
    <header className="topbar"><div className="brand"><div className="brand-mark"><MapPin/></div><div><strong>מאגר מיקומים</strong><span>קבוצת דנאל</span></div></div><div className="user-box"><span>{session.user.full_name}</span><small>{session.user.role==='owner'?'בעלים':'מנהל'}</small>{session.user.role==='owner'&&<button onClick={()=>setUsersOpen(true)} title="ניהול משתמשים"><UserCog size={18}/></button>}<button onClick={logout} title="יציאה"><LogOut size={18}/></button></div></header>
    <section className="hero"><div><p className="eyebrow">מרכז מיקומים תפעולי</p><h1>אתרי עבודה ונקודות דיווח</h1><p>כל התחנות, הקטעים, הקילומטרים וקישורי הניווט במקום אחד.</p></div><button className="primary" onClick={()=>setEditing(blankLocation(category))}><Plus size={18}/> הוספת מיקום</button></section>
    <section className="stats"><Stat icon={<Building2/>} label="אתרי עבודה" value={items.filter(x=>x.category==='work_site').length}/><Stat icon={<Navigation/>} label="נקודות דיווח" value={items.filter(x=>x.category==='reporting_point').length}/><Stat icon={<MapPin/>} label="תחנות" value={items.filter(x=>x.place_type==='station').length}/><Stat icon={<Users/>} label="קטעים" value={items.filter(x=>x.place_type==='segment').length}/></section>
    <section className="panel"><div className="tabs"><button className={category==='work_site'?'active':''} onClick={()=>setCategory('work_site')}>אתרי עבודה</button><button className={category==='reporting_point'?'active':''} onClick={()=>setCategory('reporting_point')}>נקודות דיווח</button></div><div className="toolbar"><label className="search"><Search size={18}/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="חיפוש לפי שם, ק״מ או הערה"/></label><select value={placeType} onChange={e=>setPlaceType(e.target.value as PlaceType|'all')}><option value="all">כל הסוגים</option><option value="station">תחנות</option><option value="segment">קטעים</option></select></div>
      {error&&<div className="error-box">{error}</div>}
      <div className="cards">{loading?<div className="empty"><h3>טוען מיקומים...</h3></div>:filtered.map(item=><article className="location-card" key={item.id}><div className="card-head"><span className="type-pill">{item.place_type==='station'?'תחנה':'קטע'}</span><div className="card-actions"><button onClick={()=>setEditing(item)}><Pencil size={16}/></button><button className="danger" onClick={()=>removeLocation(item.id)}><Trash2 size={16}/></button></div></div><h3>{item.name}</h3><div className="km">ק״מ {item.km||'לא הוזן'}</div>{item.coordinates&&<small>{item.coordinates}</small>}{item.notes&&<p>{item.notes}</p>}<div className="nav-actions">{item.waze_url&&<a href={item.waze_url} target="_blank" rel="noreferrer">פתיחה ב-Waze <ExternalLink size={15}/></a>}{item.maps_url&&<a href={item.maps_url} target="_blank" rel="noreferrer">Google Maps <ExternalLink size={15}/></a>}{!item.waze_url&&!item.maps_url&&<span className="muted">טרם הוזן קישור ניווט</span>}</div></article>)}{!loading&&!filtered.length&&<div className="empty"><MapPin size={42}/><h3>לא נמצאו מיקומים</h3><p>אפשר להוסיף מיקום חדש או לשנות את הסינון.</p></div>}</div>
    </section>
    {editing&&<LocationModal item={editing} onClose={()=>setEditing(null)} onSave={saveLocation}/>} 
    {usersOpen&&<UsersModal session={session} onClose={()=>setUsersOpen(false)}/>} 
  </main>;
}

function Login({onLogin}:{onLogin:(session:Session)=>void}){
  const[username,setUsername]=useState('');const[password,setPassword]=useState('');const[error,setError]=useState('');const[loading,setLoading]=useState(false);
  async function submit(e:FormEvent){e.preventDefault();setLoading(true);setError('');try{onLogin(await request<Session>('/auth/login',{method:'POST',body:JSON.stringify({username,password})}))}catch(e){setError((e as Error).message)}finally{setLoading(false)}}
  return <main className="login-shell"><section className="login-brand"><div className="brand-glow"/><div className="large-pin"><MapPin/></div><div><p className="eyebrow light">מרכז המיקומים התפעולי</p><h1>מאגר<br/>מיקומים</h1><p>אתרי עבודה, נקודות דיווח, תחנות וקטעים — מסודרים ונגישים מכל מכשיר.</p></div><div className="brand-features"><span><ShieldCheck/> כניסה מאובטחת</span><span><Navigation/> ניווט מהיר</span><span><MapPin/> מיקומים מדויקים</span></div></section><section className="login-panel"><form className="login-card" onSubmit={submit}><p className="eyebrow">ברוכים הבאים</p><h2>כניסה למערכת</h2><p className="muted">הזינו את פרטי הזיהוי כדי להיכנס למאגר.</p><label>שם משתמש<input value={username} onChange={e=>setUsername(e.target.value)} autoComplete="username" required/></label><label>סיסמה<input type="password" value={password} onChange={e=>setPassword(e.target.value)} autoComplete="current-password" required/></label>{error&&<div className="error-box">{error}</div>}<button className="primary wide" disabled={loading}>{loading?'מתחבר...':'כניסה למערכת'} <ChevronLeft size={18}/></button></form></section></main>
}

function ChangePassword({session,onChanged,onLogout}:{session:Session;onChanged:(s:Session)=>void;onLogout:()=>void}){
 const[current,setCurrent]=useState('');const[next,setNext]=useState('');const[confirmPassword,setConfirm]=useState('');const[error,setError]=useState('');
 async function submit(e:FormEvent){e.preventDefault();if(next!==confirmPassword){setError('אימות הסיסמה אינו תואם');return}try{onChanged(await request<Session>('/auth/change-password',{method:'POST',body:JSON.stringify({current_password:current,new_password:next})},session.token))}catch(e){setError((e as Error).message)}}
 return <main className="login-shell"><section className="login-brand"><div className="large-pin"><ShieldCheck/></div><h1>אבטחת<br/>החשבון</h1></section><section className="login-panel"><form className="login-card" onSubmit={submit}><h2>החלפת סיסמה ראשונית</h2><p className="muted">לפני הכניסה יש לבחור סיסמה אישית בת 10 תווים לפחות.</p><label>סיסמה נוכחית<input type="password" value={current} onChange={e=>setCurrent(e.target.value)} required/></label><label>סיסמה חדשה<input type="password" minLength={10} value={next} onChange={e=>setNext(e.target.value)} required/></label><label>אימות סיסמה<input type="password" minLength={10} value={confirmPassword} onChange={e=>setConfirm(e.target.value)} required/></label>{error&&<div className="error-box">{error}</div>}<button className="primary wide">שמירת סיסמה</button><button type="button" className="secondary wide" onClick={onLogout}>יציאה</button></form></section></main>
}

function LocationModal({item,onClose,onSave}:{item:LocationItem|LocationDraft;onClose:()=>void;onSave:(i:LocationItem|LocationDraft)=>void}){
 const[form,setForm]=useState(item);const set=(key:string,value:string)=>setForm({...form,[key]:value} as typeof form);
 return <div className="modal-backdrop"><form className="modal" onSubmit={e=>{e.preventDefault();onSave(form)}}><div className="modal-head"><div><p className="eyebrow">ניהול מיקום</p><h2>{'id'in item?'עריכת מיקום':'הוספת מיקום חדש'}</h2></div><button type="button" onClick={onClose}>×</button></div><div className="form-grid"><label>מאגר<select value={form.category} onChange={e=>set('category',e.target.value)}><option value="work_site">אתרי עבודה</option><option value="reporting_point">נקודות דיווח</option></select></label><label>סוג<select value={form.place_type} onChange={e=>set('place_type',e.target.value)}><option value="station">תחנה</option><option value="segment">קטע</option></select></label><label className="full">שם המיקום<input value={form.name} onChange={e=>set('name',e.target.value)} placeholder="לדוגמה: קטע אשדוד - ניצנים" required/></label><label>ק״מ<input value={form.km} onChange={e=>set('km',e.target.value)} placeholder="145+000"/></label><label>קואורדינטות<input value={form.coordinates} onChange={e=>set('coordinates',e.target.value)} placeholder="31.8000, 34.6500"/></label><label className="full">קישור Waze<input value={form.waze_url} onChange={e=>set('waze_url',e.target.value)} placeholder="https://waze.com/ul?..."/></label><label className="full">קישור Google Maps<input value={form.maps_url} onChange={e=>set('maps_url',e.target.value)} placeholder="https://maps.google.com/..."/></label><label className="full">הערות<textarea value={form.notes} onChange={e=>set('notes',e.target.value)} rows={3}/></label></div><div className="modal-actions"><button type="button" className="secondary" onClick={onClose}>ביטול</button><button className="primary">שמירת מיקום</button></div></form></div>
}

function UsersModal({session,onClose}:{session:Session;onClose:()=>void}){
 const[users,setUsers]=useState<User[]>([]);const[username,setUsername]=useState('');const[fullName,setFullName]=useState('');const[password,setPassword]=useState('');const[error,setError]=useState('');
 const load=()=>request<User[]>('/users',{},session.token).then(setUsers).catch(e=>setError(e.message));useEffect(load,[]);
 async function add(e:FormEvent){e.preventDefault();try{await request('/users',{method:'POST',body:JSON.stringify({username,full_name:fullName,password,role:'manager'})},session.token);setUsername('');setFullName('');setPassword('');load()}catch(e){setError((e as Error).message)}}
 async function toggle(id:number){try{await request(`/users/${id}/toggle`,{method:'PATCH'},session.token);load()}catch(e){setError((e as Error).message)}}
 return <div className="modal-backdrop"><section className="modal"><div className="modal-head"><div><p className="eyebrow">בעלים בלבד</p><h2>ניהול משתמשים</h2></div><button onClick={onClose}>×</button></div><form className="form-grid" onSubmit={add}><label>שם מלא<input value={fullName} onChange={e=>setFullName(e.target.value)} required/></label><label>שם משתמש<input value={username} onChange={e=>setUsername(e.target.value)} required/></label><label className="full">סיסמה ראשונית<input type="password" minLength={10} value={password} onChange={e=>setPassword(e.target.value)} required/></label><div className="full"><button className="primary"><Plus size={17}/> יצירת מנהל</button></div></form>{error&&<div className="error-box">{error}</div>}<div className="user-list">{users.map(user=><div className="user-row" key={user.id}><div><strong>{user.full_name}</strong><small>{user.username} · {user.role==='owner'?'בעלים':'מנהל'}</small></div><span className={user.is_active?'type-pill':'muted'}>{user.is_active?'פעיל':'מושבת'}</span>{user.role!=='owner'&&<button className="secondary" onClick={()=>toggle(user.id)}>{user.is_active?'השבתה':'הפעלה'}</button>}</div>)}</div></section></div>
}

function Stat({icon,label,value}:{icon:React.ReactNode;label:string;value:number}){return <div className="stat"><span>{icon}</span><div><strong>{value}</strong><small>{label}</small></div></div>}
createRoot(document.getElementById('root')!).render(<React.StrictMode><App/></React.StrictMode>);

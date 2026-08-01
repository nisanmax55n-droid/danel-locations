import React, { FormEvent, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Building2, ChevronLeft, ExternalLink, LogOut, MapPin, Navigation, Pencil, Plus, Search, ShieldCheck, Trash2, Users } from 'lucide-react';
import './styles.css';

type Role = 'owner' | 'manager';
type Category = 'work_site' | 'reporting_point';
type PlaceType = 'station' | 'segment';

type LocationItem = {
  id: string;
  category: Category;
  placeType: PlaceType;
  name: string;
  km: string;
  wazeUrl: string;
  mapsUrl: string;
  coordinates: string;
  notes: string;
};

const seed: LocationItem[] = [{
  id: crypto.randomUUID(),
  category: 'work_site',
  placeType: 'segment',
  name: 'קטע אשדוד - ניצנים',
  km: '145+000',
  wazeUrl: '',
  mapsUrl: '',
  coordinates: '',
  notes: 'מיקום לדוגמה',
}];

function App() {
  const [user, setUser] = useState<{name:string; role:Role} | null>(null);
  const [items, setItems] = useState<LocationItem[]>(() => {
    const raw = localStorage.getItem('danel_locations');
    return raw ? JSON.parse(raw) : seed;
  });
  const [category, setCategory] = useState<Category>('work_site');
  const [placeType, setPlaceType] = useState<PlaceType | 'all'>('all');
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<LocationItem | null>(null);

  const save = (next: LocationItem[]) => {
    setItems(next);
    localStorage.setItem('danel_locations', JSON.stringify(next));
  };

  const filtered = useMemo(() => items.filter(item => {
    const matchesCategory = item.category === category;
    const matchesType = placeType === 'all' || item.placeType === placeType;
    const haystack = `${item.name} ${item.km} ${item.notes}`.toLowerCase();
    return matchesCategory && matchesType && haystack.includes(query.toLowerCase());
  }), [items, category, placeType, query]);

  if (!user) return <Login onLogin={setUser} />;

  return <main className="app-shell">
    <header className="topbar">
      <div className="brand"><div className="brand-mark"><MapPin /></div><div><strong>מאגר מיקומים</strong><span>קבוצת דנאל</span></div></div>
      <div className="user-box"><span>{user.name}</span><small>{user.role === 'owner' ? 'בעלים' : 'מנהל'}</small><button onClick={() => setUser(null)} title="יציאה"><LogOut size={18}/></button></div>
    </header>

    <section className="hero">
      <div><p className="eyebrow">מרכז מיקומים תפעולי</p><h1>אתרי עבודה ונקודות דיווח</h1><p>כל התחנות, הקטעים, הקילומטרים וקישורי הניווט במקום אחד.</p></div>
      <button className="primary" onClick={() => setEditing({id:'', category, placeType:'segment', name:'', km:'', wazeUrl:'', mapsUrl:'', coordinates:'', notes:''})}><Plus size={18}/> הוספת מיקום</button>
    </section>

    <section className="stats">
      <Stat icon={<Building2/>} label="אתרי עבודה" value={items.filter(x=>x.category==='work_site').length}/>
      <Stat icon={<Navigation/>} label="נקודות דיווח" value={items.filter(x=>x.category==='reporting_point').length}/>
      <Stat icon={<MapPin/>} label="תחנות" value={items.filter(x=>x.placeType==='station').length}/>
      <Stat icon={<Users/>} label="קטעים" value={items.filter(x=>x.placeType==='segment').length}/>
    </section>

    <section className="panel">
      <div className="tabs">
        <button className={category==='work_site'?'active':''} onClick={()=>setCategory('work_site')}>אתרי עבודה</button>
        <button className={category==='reporting_point'?'active':''} onClick={()=>setCategory('reporting_point')}>נקודות דיווח</button>
      </div>
      <div className="toolbar">
        <label className="search"><Search size={18}/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="חיפוש לפי שם, ק״מ או הערה"/></label>
        <select value={placeType} onChange={e=>setPlaceType(e.target.value as PlaceType|'all')}><option value="all">כל הסוגים</option><option value="station">תחנות</option><option value="segment">קטעים</option></select>
      </div>

      <div className="cards">
        {filtered.map(item => <article className="location-card" key={item.id}>
          <div className="card-head"><span className="type-pill">{item.placeType === 'station' ? 'תחנה' : 'קטע'}</span><div className="card-actions"><button onClick={()=>setEditing(item)}><Pencil size={16}/></button><button className="danger" onClick={()=>confirm('למחוק את המיקום?') && save(items.filter(x=>x.id!==item.id))}><Trash2 size={16}/></button></div></div>
          <h3>{item.name}</h3>
          <div className="km">ק״מ {item.km || 'לא הוזן'}</div>
          {item.notes && <p>{item.notes}</p>}
          <div className="nav-actions">
            {item.wazeUrl && <a href={item.wazeUrl} target="_blank">פתיחה ב-Waze <ExternalLink size={15}/></a>}
            {item.mapsUrl && <a href={item.mapsUrl} target="_blank">Google Maps <ExternalLink size={15}/></a>}
            {!item.wazeUrl && !item.mapsUrl && <span className="muted">טרם הוזן קישור ניווט</span>}
          </div>
        </article>)}
        {!filtered.length && <div className="empty"><MapPin size={42}/><h3>לא נמצאו מיקומים</h3><p>אפשר להוסיף מיקום חדש או לשנות את הסינון.</p></div>}
      </div>
    </section>

    {editing && <LocationModal item={editing} onClose={()=>setEditing(null)} onSave={(item)=>{
      const next = item.id ? items.map(x=>x.id===item.id?item:x) : [...items, {...item, id:crypto.randomUUID()}];
      save(next); setEditing(null);
    }}/>} 
  </main>;
}

function Login({onLogin}:{onLogin:(u:{name:string;role:Role})=>void}) {
  const [name,setName]=useState('');
  const [password,setPassword]=useState('');
  const submit=(e:FormEvent)=>{e.preventDefault(); onLogin({name:name||'מנהל מערכת',role:name.toLowerCase()==='owner'?'owner':'manager'});};
  return <main className="login-shell">
    <section className="login-brand"><div className="brand-glow"/><div className="large-pin"><MapPin/></div><div><p className="eyebrow light">מרכז המיקומים התפעולי</p><h1>מאגר<br/>מיקומים</h1><p>אתרי עבודה, נקודות דיווח, תחנות וקטעים — מסודרים ונגישים מכל מכשיר.</p></div><div className="brand-features"><span><ShieldCheck/> כניסה מאובטחת</span><span><Navigation/> ניווט מהיר</span><span><MapPin/> מיקומים מדויקים</span></div></section>
    <section className="login-panel"><form className="login-card" onSubmit={submit}><p className="eyebrow">ברוכים הבאים</p><h2>כניסה למערכת</h2><p className="muted">הזינו את פרטי הזיהוי כדי להיכנס למאגר.</p><label>שם משתמש<input value={name} onChange={e=>setName(e.target.value)} required/></label><label>סיסמה<input type="password" value={password} onChange={e=>setPassword(e.target.value)} required/></label><label className="remember"><input type="checkbox" defaultChecked/> זכור אותי במכשיר הזה</label><button className="primary wide">כניסה למערכת <ChevronLeft size={18}/></button><small>גרסת בסיס ראשונית — אימות השרת יחובר בשלב הפריסה.</small></form></section>
  </main>
}

function LocationModal({item,onClose,onSave}:{item:LocationItem;onClose:()=>void;onSave:(i:LocationItem)=>void}) {
  const [form,setForm]=useState(item);
  const set=(key:keyof LocationItem,value:string)=>setForm({...form,[key]:value});
  return <div className="modal-backdrop"><form className="modal" onSubmit={e=>{e.preventDefault();onSave(form)}}><div className="modal-head"><div><p className="eyebrow">ניהול מיקום</p><h2>{item.id?'עריכת מיקום':'הוספת מיקום חדש'}</h2></div><button type="button" onClick={onClose}>×</button></div><div className="form-grid"><label>מאגר<select value={form.category} onChange={e=>set('category',e.target.value)}><option value="work_site">אתרי עבודה</option><option value="reporting_point">נקודות דיווח</option></select></label><label>סוג<select value={form.placeType} onChange={e=>set('placeType',e.target.value)}><option value="station">תחנה</option><option value="segment">קטע</option></select></label><label className="full">שם המיקום<input value={form.name} onChange={e=>set('name',e.target.value)} placeholder="לדוגמה: קטע אשדוד - ניצנים" required/></label><label>ק״מ<input value={form.km} onChange={e=>set('km',e.target.value)} placeholder="145+000"/></label><label>קואורדינטות<input value={form.coordinates} onChange={e=>set('coordinates',e.target.value)} placeholder="31.8000, 34.6500"/></label><label className="full">קישור Waze<input value={form.wazeUrl} onChange={e=>set('wazeUrl',e.target.value)} placeholder="https://waze.com/ul?..."/></label><label className="full">קישור Google Maps<input value={form.mapsUrl} onChange={e=>set('mapsUrl',e.target.value)} placeholder="https://maps.google.com/..."/></label><label className="full">הערות<textarea value={form.notes} onChange={e=>set('notes',e.target.value)} rows={3}/></label></div><div className="modal-actions"><button type="button" className="secondary" onClick={onClose}>ביטול</button><button className="primary">שמירת מיקום</button></div></form></div>
}

function Stat({icon,label,value}:{icon:React.ReactNode;label:string;value:number}){return <div className="stat"><span>{icon}</span><div><strong>{value}</strong><small>{label}</small></div></div>}

createRoot(document.getElementById('root')!).render(<React.StrictMode><App/></React.StrictMode>);

// Development-only interaction fixture; excluded from the production entry points.
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Select } from '../src/components/controls/Select';
import { DateTimeInput } from '../src/components/controls/DateTimeInput';
import '../src/styles/global.css';
import '../src/styles/controls.css';
function Fixture() {
  const [selected, setSelected] = useState('a');
  const [date, setDate] = useState('2026-11-02');
  const [time, setTime] = useState('10:15');
  const [result, setResult] = useState('');
  return <form style={{padding:40, display:'grid',gap:20,width:400}} onSubmit={e=>{e.preventDefault();setResult(JSON.stringify(Object.fromEntries(new FormData(e.currentTarget))));}}>
    <Select name="selected" aria-label="Controlled select" value={selected} onChange={e=>setSelected(e.target.value)}><option value="a">Alpha</option><option value="b">Beta</option><option disabled value="c">Disabled option</option></Select>
    <Select name="uncontrolled" aria-label="Uncontrolled select" defaultValue="first"><option value="first">First</option><option value="second">Second</option></Select>
    <Select aria-label="Disabled select" disabled><option>Disabled</option></Select>
    <Select aria-label="Reset after pick" defaultValue="" onChange={e=>{setResult(e.target.value);e.target.value='';}}><option value="">Pick action</option><option value="action">Run action</option></Select>
    <DateTimeInput name="date" type="date" aria-label="Fixture date" min="2026-11-01" max="2026-11-20" value={date} onChange={e=>setDate(e.target.value)} />
    <DateTimeInput name="time" type="time" aria-label="Fixture time" value={time} onChange={e=>setTime(e.target.value)} />
    <DateTimeInput name="optional" type="date" aria-label="Uncontrolled date" defaultValue="2026-11-01" />
    <input type="checkbox" aria-label="Checkbox" name="check" /><input type="radio" name="radio" aria-label="Radio" value="one" />
    <input type="number" name="amount" aria-label="Amount" defaultValue={2} min={1} max={5} required />
    <button type="submit">Submit</button><button type="reset">Reset</button><output>{result}</output>
  </form>;
}
createRoot(document.getElementById('fixture')!).render(<Fixture />);

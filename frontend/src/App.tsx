import React, { useEffect, useState } from "react";
import MapView from "./components/MapView";
import Plans from "./components/Plans";
import Reports from "./components/Reports";
import { auth, login, logout } from "./firebase";
import { onAuthStateChanged, User } from "firebase/auth";

export default function App(){
  const [user, setUser] = useState<User|null>(auth.currentUser);
  const [tab, setTab] = useState<"map"|"plans"|"reports">("map");

  useEffect(()=> onAuthStateChanged(auth, setUser), []);

  if(!user){
    return (
      <div style={{display:"grid",placeItems:"center",height:"100%"}}>
        <div style={{textAlign:"center"}}>
          <h1>RINTO Clone MVP</h1>
          <p>Googleでログインして開始</p>
          <button onClick={login}>Googleでログイン</button>
        </div>
      </div>
    );
  }

  return (
    <div style={{height:"100%", display:"grid", gridTemplateRows:"48px 1fr"}}>
      <header>
        <strong style={{flex:1}}>RINTO Clone MVP</strong>
        <nav style={{display:"flex",gap:8}}>
          <button onClick={()=>setTab("map")}>地図</button>
          <button onClick={()=>setTab("plans")}>施業計画</button>
          <button onClick={()=>setTab("reports")}>日報</button>
        </nav>
        <div>{user.displayName}</div>
        <button onClick={logout}>ログアウト</button>
      </header>
      {tab === "map" && <MapView />}
      {tab === "plans" && <Plans />}
      {tab === "reports" && <Reports />}
    </div>
  );
}

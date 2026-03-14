
import React, { useEffect, useState } from "react";
import { supabase } from "./supabaseClient";

export default function App() {

  const [tables, setTables] = useState([]);
  const [status, setStatus] = useState("CONNECTING");

  useEffect(() => {

    async function testConnection() {

      const { data, error } = await supabase
        .from("service_tables")
        .select("*")
        .limit(1);

      if (error) {
        console.error("Supabase connection failed:", error);
        setStatus("ERROR");
      } else {
        console.log("Supabase connected:", data);
        setStatus("SYNC");
      }
    }

    testConnection();

    const channel = supabase
      .channel("service_tables_realtime")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "service_tables" },
        () => testConnection()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };

  }, []);

  return (
    <div style={{padding:40,fontFamily:"sans-serif"}}>
      <h2>Milka Service Board</h2>

      <div style={{
        padding:"6px 12px",
        background: status === "SYNC" ? "#c8f5d1" : "#ffd6d6",
        display:"inline-block",
        borderRadius:10,
        marginBottom:20
      }}>
        {status}
      </div>

      <div>
        {tables.map(t => (
          <div key={t.id}>
            {JSON.stringify(t)}
          </div>
        ))}
      </div>

    </div>
  );
}

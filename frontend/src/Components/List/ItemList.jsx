import React,{ useEffect, useState } from 'react';
import { API, C, S } from '../../App';
import ItemEdit from '../Helper/ItemEdit';

export default function ItemList({ handleEdit }) {
  const [loading, setLoading] = useState(false);
  const [data,    setData]    = useState([]);

  const load = async () => {
    setLoading(true);
    try {
      const res  = await fetch(`${API}/parent-prices/`);
      const json = await res.json();
      setData(json.results ?? []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  if (loading) return (
    <div style={{ textAlign: "center", padding: "20px 0", color: C.gray400, fontSize: 13 }}>
      Loading parent items…
    </div>
  );

  if (data.length === 0) return (
    <div style={{ textAlign: "center", padding: "20px 0", color: C.gray400, fontSize: 13, fontStyle: "italic" }}>
      No parent items yet — add one above.
    </div>
  );

  return (
    <div style={{ overflowX: "auto", borderRadius: 8, border: `1px solid ${C.border}`, overflow: "hidden", marginTop: 14 }}>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr>
            {[
              { h: "Item ID",      align: "left"  },
              { h: "Price",        align: "right" },
              { h: "Tax %",        align: "center"},
              { h: "Packaging",    align: "right" },
              { h: "Final Price",  align: "right" },
              { h: "Linked SKUs",  align: "left"  },
              { h: "",             align: "left"  },
            ].map(({ h, align }, i) => (
              <th key={h || i} style={{ ...S.th, textAlign: align, fontSize: 10 }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.map((item, i) => (
            <ItemEdit
              key={item.item_id}
              item={item}
              handleEdit={handleEdit}
              rowBg={i % 2 === 0 ? C.white : C.gray50}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

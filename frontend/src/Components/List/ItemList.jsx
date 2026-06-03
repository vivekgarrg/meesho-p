import React, { useEffect, useState } from 'react'
import { API, S } from '../../App'
import ItemEdit from '../Helper/ItemEdit';

export default function ItemList({handleEdit}) {
    const [isLoading, setLoading] = useState(false);
    const [data, setData] = useState([]);

    const handleApiCall = async()=>{ 
        const url =  `${API}/parent-prices/`;
        setLoading(true);
        try{
            const res = await fetch(url);
            let response = await res.json();
            setData(response.results ?? []);
        }catch(err){
            console.error(err);
        }finally{
            setLoading(false);
        }
    }

    useEffect(()=>{
        handleApiCall();
    },[])

  if(isLoading) return <div>Loading...</div>  


  return (
    <div style={{...S.card, marginTop: "8px"}}>
        {Array.isArray(data) &&  data.map((item)=>(
            <ItemEdit key={item.item_id} item={item} handleEdit={handleEdit}/>
        ))}
    </div>
  )
}

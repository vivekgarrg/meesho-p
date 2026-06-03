import React from 'react'
import SkuItem from './SkuItem'
import { C, Tag } from '../../App'
import { btn } from '../../App'

export default function ItemEdit({item, handleEdit}) {
  const styling = {fontSize: 14}

  return (
    <div style={{margin: "16px",border: `1px solid ${C.gray200}`, borderBottom:`2px solid ${C.gray300}`, borderRadius:"0.5rem", padding:"1rem", display:"flex", justifyContent:"space-between", alignItems:"flex-start"}}>
      <div>
      <Tag fontSize={20} variant='orange'>
         {item.item_id}
      </Tag>
      &nbsp;&nbsp;
      <Tag {...styling} variant='gray'>
        Price: {item.item_price}
      </Tag>
      &nbsp;&nbsp;
      <Tag {...styling} variant='gray'>
         Tax: {item.tax_percent}
      </Tag>
      &nbsp;&nbsp;
      <Tag {...styling} variant='gray'>
         Packing Cost: {item.packaging_cost}
      </Tag>
      &nbsp;&nbsp;
      <Tag {...styling} variant='green'>
         Final Price: {item.final_price}
      </Tag>
      &nbsp;&nbsp;
        {item &&  item.sku_ids.map((sku)=>(
            <SkuItem sku={sku}/>
        ))}
      </div>
      <div>
        <button onClick={()=>handleEdit(item)} style={{...btn("primary"), marginLeft: "5rem"}}>
          Edit
        </button>
      </div>
      
    </div>
  )
}

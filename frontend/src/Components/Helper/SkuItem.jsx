import React from 'react'
import { C, Tag } from '../../App'

export default function SkuItem({sku, onClick}) {
  return (
    <div onClick={onClick} style={{margin: "1rem", cursor: onClick && "pointer"}}>
      <Tag fontSize={15} variant={onClick ? 'red' : 'blue'}> 
        ↳ {sku}
      </Tag>
        <span style={{fontFamily: "monospace", fontWeight: 700, color: C.gray500}}>  </span>
    </div>
  )
}

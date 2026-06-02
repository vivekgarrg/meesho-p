import React from 'react'
import { C, Tag } from '../../App'

export default function SkuItem({sku}) {
  return (
    <div style={{margin: "1rem"}}>
      <Tag fontSize={15} variant='blue'> 
        ↳ {sku}
      </Tag>
        <span style={{fontFamily: "monospace", fontWeight: 700, color: C.gray500}}>  </span>
    </div>
  )
}

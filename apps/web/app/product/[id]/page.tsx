'use client';
import { use } from 'react';
import Link from 'next/link';
import { ProductDetail } from '../../../components/ProductDetail';
export default function Product({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <><div className="crumbs"><Link href="/">Buy</Link>›<b>Product</b></div><div className="card" style={{ padding: 0 }}><ProductDetail id={id} variant="page" /></div></>;
}

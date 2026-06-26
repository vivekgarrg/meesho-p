def status_wise_summary(order_wise_profit, status):
    summary = {}
    summary["order_count"] = sum(v.get(f"{status}_count",  0) for v in order_wise_profit.values())
    summary["packaging_cost"] = sum(v.get(f"{status}_packaging_cost",  0) for v in order_wise_profit.values())
    summary["purchase_cost"] = sum(v.get(f"{status}_purchase_cost",  0) for v in order_wise_profit.values())
    summary["final_item_cost"] = sum(v.get(f"{status}_final_purchase_cost",  0) for v in order_wise_profit.values())
    summary["tax_cost"] = sum(v.get(f"{status}_tax_cost",  0) for v in order_wise_profit.values())
    summary["total_settlement"] = sum(v.get(f"{status}_total_settlement",  0) for v in order_wise_profit.values())
    summary["net_profit_loss"]  = sum(v.get(f"{status}_profit",  0) or v.get(f"{status}_loss",  0) for v in order_wise_profit.values())
    return summary
    
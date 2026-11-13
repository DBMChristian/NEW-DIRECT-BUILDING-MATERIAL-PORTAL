/* only Christian connects or reconnects Xero (13 Nov 2026): the buttons show for him alone, and the xero function refuses
   anyone else */
export const XERO_OWNERS = ['christian@discountbuildingmaterial.com.au'];
export const canConnectXero = (staff) => !!staff && XERO_OWNERS.includes(String(staff.email || '').toLowerCase());

// Calculates profit on the server, so Entry users never need to read costs.
const { onDocumentCreated } = require("firebase-functions/v2/firestore");
const admin = require("firebase-admin");
admin.initializeApp();

exports.recordProfit = onDocumentCreated("orders/{soNo}", async (event) => {
  const order = event.data.data();
  const db = admin.firestore();
  const costSnap = await db.collection("productCosts").get();
  const costs = {};
  costSnap.forEach((d) => (costs[d.id] = d.data().cost));

  let totalProfit = 0;
  const lines = order.lines.map((l) => {
    const costPrice = costs[l.productId] ?? 0;
    const unitProfit = l.unitPrice - costPrice;
    const lineProfit = unitProfit * l.qty;
    totalProfit += lineProfit;
    return { productId: l.productId, name: l.name, pack: l.pack, qty: l.qty,
      retailPrice: l.unitPrice, costPrice, unitProfit, lineProfit };
  });

  await db.collection("orderProfit").doc(event.params.soNo).set({
    soNo: event.params.soNo, day: order.day, month: order.month, year: order.year,
    createdBy: order.createdBy, lines, totalProfit,
  });
});

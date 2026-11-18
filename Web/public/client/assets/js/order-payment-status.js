(() => {
  const heading = document.querySelector("[data-payment-heading]");
  const message = document.querySelector("[data-payment-message]");
  const retry = document.querySelector("[data-payment-retry]");
  if (!heading || !message || !retry) return;

  const statusUrl = new URL(window.location.href);
  statusUrl.searchParams.set("paymentCheck", "1");
  const deadline = Date.now() + 30000;

  async function checkPayment() {
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      heading.textContent = "Payment Pending";
      message.textContent = " Payment hasn’t been confirmed yet. If you already paid, check the status again before retrying.";
      retry.classList.remove("d-none");
      return;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), Math.min(5000, remaining));
    try {
      const response = await fetch(statusUrl, { signal: controller.signal, cache: "no-store" });
      if (response.ok && (await response.json()).settled === true) {
        window.location.reload();
        return;
      }
    } catch {
      // A temporary connection problem should not end the payment check.
    } finally {
      clearTimeout(timeout);
    }

    setTimeout(checkPayment, Math.max(0, Math.min(2000, deadline - Date.now())));
  }

  setTimeout(checkPayment, 2000);
})();

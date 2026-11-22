
const menuBtn = document.getElementById("menuBtn");
const sideMenu = document.getElementById("sideMenu");
const closeMenu = document.getElementById("closeMenu");
const menuOverlay = document.getElementById("menuOverlay");

function openMenu() {
    if (sideMenu) sideMenu.classList.add("active");
    if (menuOverlay) menuOverlay.classList.add("active");
}

function closeSideMenu() {
    if (sideMenu) sideMenu.classList.remove("active");
    if (menuOverlay) menuOverlay.classList.remove("active");
}

if (menuBtn) menuBtn.addEventListener("click", openMenu);
if (closeMenu) closeMenu.addEventListener("click", closeSideMenu);
if (menuOverlay) menuOverlay.addEventListener("click", closeSideMenu);

document.querySelectorAll(".menu-links a").forEach(link => {
    link.addEventListener("click", closeSideMenu);
});

function showBalance(balance) {
    const amount = Number(balance);

    if (!Number.isFinite(amount)) return;

    const formatted = amount.toFixed(2) + " AZN";

    const menuAmount = document.getElementById("menuBalanceAmount");
    const homeAmount = document.getElementById("homeBalanceAmount");

    if (menuAmount) menuAmount.textContent = formatted;
    if (homeAmount) homeAmount.textContent = formatted;
}

function hideBalance() {
    const menuBalance = document.getElementById("menuBalance");
    const homeBalance = document.getElementById("homeBalance");

    if (menuBalance) menuBalance.hidden = true;
    if (homeBalance) homeBalance.hidden = true;
}

async function checkUserStatus() {
    try {
        const response = await fetch("/api/me");
        const data = await response.json();

        const menuLinks = document.querySelector(".menu-links");

        if (!menuLinks) return;

        const loginLink = document.getElementById("loginLink");
        const registerLink = document.getElementById("registerLink");
        const profileLink = document.getElementById("profileLink");
        const heroProfileLink = document.getElementById("heroProfileLink");
        const aboutRegisterLink = document.getElementById("aboutRegisterLink");
        const cartLink = document.getElementById("cartLink");
        const ordersLink = document.getElementById("ordersLink");

        let logoutLink = document.getElementById("logoutLink");

        if (data.loggedIn === true) {
            if (loginLink) loginLink.hidden = true;
            if (registerLink) registerLink.hidden = true;
            if (profileLink) profileLink.hidden = false;
            if (heroProfileLink) heroProfileLink.hidden = false;
            if (aboutRegisterLink) aboutRegisterLink.hidden = true;
            if (cartLink) cartLink.style.display = "flex";
            if (ordersLink) ordersLink.style.display = "flex";

            const menuBalance = document.getElementById("menuBalance");
            const homeBalance = document.getElementById("homeBalance");

            if (menuBalance) menuBalance.hidden = false;
            if (homeBalance) homeBalance.hidden = false;

            // Balansı serverdən götür
            try {
                const balanceResponse = await fetch("/api/balance");
                const balanceData = await balanceResponse.json();

                if (balanceResponse.ok && balanceData.success) {
                    const balance =
                        balanceData.balance ??
                        balanceData.user?.balance;

                    if (balance !== undefined) {
                        showBalance(balance);
                    }
                }
            } catch (error) {
                console.error("Balans alınmadı:", error);
            }

            if (!logoutLink) {
                logoutLink = document.createElement("a");
                logoutLink.id = "logoutLink";
                logoutLink.href = "#";
                logoutLink.textContent = "↪ Çıxış et";
                menuLinks.appendChild(logoutLink);

                logoutLink.addEventListener("click", async function(e) {
                    e.preventDefault();

                    try {
                        const result = await fetch("/api/logout", {
                            method: "POST"
                        });

                        const logoutData = await result.json();

                        if (logoutData.success) {
                            window.location.href = "/";
                        } else {
                            alert("Çıxış zamanı xəta baş verdi.");
                        }
                    } catch (error) {
                        alert("Serverlə əlaqə yaratmaq mümkün olmadı.");
                    }
                });
            }

            logoutLink.style.display = "flex";

        } else {
            if (loginLink) loginLink.hidden = false;
            if (registerLink) registerLink.hidden = false;
            if (profileLink) profileLink.hidden = true;
            if (heroProfileLink) heroProfileLink.hidden = true;
            if (aboutRegisterLink) aboutRegisterLink.hidden = false;
            if (cartLink) cartLink.style.display = "none";
            if (ordersLink) ordersLink.style.display = "none";

            if (logoutLink) logoutLink.style.display = "none";

            hideBalance();
        }

    } catch (error) {
        console.error("İstifadəçi yoxlanılmadı:", error);
        hideBalance();
    }
}

checkUserStatus();

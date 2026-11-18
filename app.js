"use strict";

const supabaseClient = window.icaSupabase;
const $ = (id) => document.getElementById(id);
const money = (value) => "Rp" + Number(value || 0).toLocaleString("id-ID");
const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
}[char]));
const imageUrl = (value) => typeof value === "string" && /^https?:\/\//i.test(value) ? value : "";

const state = {
  recipes: [],
  products: [],
  productByCode: {},
  user: null,
  profile: null,
  entitlements: [],
  isVip: false,
  recipeBookPurchased: false,
  monthlyPlanPurchased: false,
  budget: 120000,
  diet: "all",
  selectedDay: 0,
  plan: "monthly",
  showAllRecipes: false,
  authMode: "login",
  weekPlan: null,
  weekItems: [],
  monthlyPlan: null,
  monthlyItems: [],
  shoppingListId: null,
  shoppingItems: [],
  currentMealFromMonthly: false
};

let meals = [];
let currentUserLoadId = null;
let heroObserver = null;
let heroTimer = null;
let heroCursor = 0;

function toast(message) {
  const el = $("toast");
  if (!el) return;
  el.textContent = message;
  el.classList.remove("hidden");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.classList.add("hidden"), 2800);
}

function todayIso() {
  const now = new Date();
  return now.getFullYear() + "-" + String(now.getMonth() + 1).padStart(2, "0") + "-" + String(now.getDate()).padStart(2, "0");
}

function addDaysIso(dateString, amount) {
  const date = new Date(dateString + "T12:00:00");
  date.setDate(date.getDate() + amount);
  return date.getFullYear() + "-" + String(date.getMonth() + 1).padStart(2, "0") + "-" + String(date.getDate()).padStart(2, "0");
}

function mondayIso(date) {
  const d = date ? new Date(date + "T12:00:00") : new Date();
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}

function dateLabel(dateString, options) {
  return new Intl.DateTimeFormat("id-ID", options || {}).format(new Date(dateString + "T12:00:00"));
}

function shortDay(dateString) {
  return dateLabel(dateString, { weekday: "short" }).replace(".", "").slice(0, 3).toUpperCase();
}

function recipeAsMeal(recipe, plannedOn, servings) {
  return {
    id: recipe.id,
    recipe_id: recipe.id,
    planned_on: plannedOn,
    day: shortDay(plannedOn),
    date: String(new Date(plannedOn + "T12:00:00").getDate()).padStart(2, "0"),
    name: recipe.title,
    price: recipe.estimated_cost_idr || 0,
    image: recipe.cover_image_url,
    cal: recipe.calories || 0,
    protein: Number(recipe.protein_g || 0),
    carbs: Number(recipe.carbs_g || 0),
    fat: Number(recipe.fat_g || 0),
    tags: recipe.tags || [],
    description: recipe.description || "",
    access_tier: recipe.access_tier,
    servings: servings || 1
  };
}

function filteredMeals() {
  if (state.diet === "all") return meals;
  return meals.filter((meal) => (meal.tags || []).includes(state.diet));
}

function estimate() {
  const base = state.diet === "protein" ? 105000 : state.diet === "vegan" ? 82000 : state.diet === "hemat" ? 70000 : 77500;
  return Math.round(base * (state.budget / 120000) * 0.7 + base * 0.3);
}

function hasActiveEntitlement(code) {
  const now = Date.now();
  return state.entitlements.some((entitlement) =>
    entitlement.entitlement_code === code &&
    entitlement.status === "active" &&
    new Date(entitlement.starts_at).getTime() <= now &&
    (!entitlement.expires_at || new Date(entitlement.expires_at).getTime() > now)
  );
}

function syncEntitlementFlags() {
  state.isVip = hasActiveEntitlement("membership");
  state.recipeBookPurchased = hasActiveEntitlement("recipe_book");
  state.monthlyPlanPurchased = hasActiveEntitlement("monthly_meal_plan");
}

function renderBudget() {
  const cost = estimate();
  const remaining = state.budget - cost;
  $("budgetInput").value = state.budget;
  $("budgetRange").value = state.budget;
  $("estimatedCost").textContent = money(cost);
  $("budgetAvailable").textContent = money(state.budget);
  $("budgetRemaining").textContent = money(remaining);
  $("budgetMeter").style.width = Math.min(100, (cost / Math.max(1, state.budget)) * 100) + "%";
  $("budgetStatus").textContent = remaining >= 0 ? "✓ Masih dalam anggaran" : "⚠ Melebihi anggaran";
  $("budgetStatus").classList.toggle("over", remaining < 0);
}

function renderPlanner() {
  const list = filteredMeals();
  $("weekGrid").innerHTML = list.map((meal) => {
    const index = meals.indexOf(meal);
    const locked = index >= 3 && !state.isVip;
    return '<button class="day-card ' + (index === state.selectedDay ? "selected " : "") + (locked ? "locked" : "") + '" data-day="' + index + '">' +
      '<div class="day-top"><span>' + escapeHtml(meal.day) + '</span><b>' + escapeHtml(meal.date) + '</b></div>' +
      '<img src="' + escapeHtml(imageUrl(meal.image)) + '" alt="' + escapeHtml(meal.name) + '">' +
      '<h3>' + (locked ? "Menu premium" : escapeHtml(meal.name)) + '</h3>' +
      '<span class="day-price">' + (locked ? "GOOD FOOD CLUB" : money(meal.price)) + '</span>' +
      (locked ? '<span class="lock-label">🔒 PREMIUM MENU</span>' : "") +
      '</button>';
  }).join("");

  $("weekGrid").querySelectorAll("[data-day]").forEach((button) => {
    button.addEventListener("click", () => selectDay(Number(button.dataset.day)));
  });
  $("weeklyLockedNotice").classList.toggle("hidden", state.isVip);
}

function showMealDetail(meal, dayCaption, fromMonthly) {
  state.currentMealFromMonthly = Boolean(fromMonthly);
  $("detailImage").src = imageUrl(meal.image);
  $("detailImage").alt = meal.name;
  $("detailDay").textContent = dayCaption;
  $("detailTitle").textContent = meal.name;
  $("detailDescription").textContent = meal.description || "Menu sederhana dengan bahan yang mudah ditemukan.";
  $("macroCalories").textContent = meal.cal || 0;
  $("macroProtein").textContent = (meal.protein || 0) + "g";
  $("macroCarbs").textContent = (meal.carbs || 0) + "g";
  $("macroFat").textContent = (meal.fat || 0) + "g";
  $("detailPrice").textContent = money(meal.price);
  $("detailRecipe").onclick = () => openRecipe(meal.id, { fromMonthly: Boolean(fromMonthly) });
}

function selectDay(index) {
  const meal = meals[index];
  if (!meal) return;
  if (index >= 3 && !state.isVip) {
    openModal("subscriptionModal");
    return;
  }
  state.selectedDay = index;
  renderPlanner();
  const month = dateLabel(meal.planned_on, { month: "short" }).toUpperCase();
  showMealDetail(meal, meal.day + " · " + meal.date + " " + month, false);
}

function initHeroMotion() {
  const stage = document.querySelector(".hero-motion-stage");
  if (!stage || !state.recipes.length) return;
  const cards = [...stage.querySelectorAll("[data-hero-food]")];

  const paint = () => {
    cards.forEach((img, index) => {
      const recipe = state.recipes[(heroCursor + index * 2) % state.recipes.length];
      img.classList.add("is-changing");
      window.setTimeout(() => {
        img.src = imageUrl(recipe.cover_image_url);
        img.alt = "Inspirasi menu " + recipe.title;
        img.onload = () => img.classList.remove("is-changing");
        img.onerror = () => img.classList.remove("is-changing");
      }, 180);
    });
    $("heroFoodCaption").textContent = state.recipes[heroCursor % state.recipes.length].title;
    heroCursor = (heroCursor + 1) % state.recipes.length;
  };

  paint();
  const start = () => {
    if (heroTimer || document.hidden || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    heroTimer = window.setInterval(paint, 4600);
  };
  const stop = () => {
    if (heroTimer) {
      clearInterval(heroTimer);
      heroTimer = null;
    }
  };

  if (heroObserver) heroObserver.disconnect();
  heroObserver = new IntersectionObserver((entries) => {
    entries.forEach((entry) => entry.isIntersecting ? start() : stop());
  }, { threshold: 0.12 });
  heroObserver.observe(stage);
  document.addEventListener("visibilitychange", () => document.hidden ? stop() : start());
}

function renderRecipes() {
  const allRecipes = state.recipes;
  const visibleRecipes = state.showAllRecipes ? allRecipes : allRecipes.slice(0, 10);
  const preview = $("recipeHoverPreview");
  const previewImage = $("recipeHoverImage");
  const previewLabel = $("recipeHoverLabel");

  $("recipeGrid").innerHTML = visibleRecipes.map((recipe, index) => {
    const locked = recipe.access_tier === "premium" && !state.isVip && !state.recipeBookPurchased;
    return '<button class="recipe-row ' + (locked ? "recipe-row-locked" : "") + '" type="button" data-recipe="' + recipe.id + '" data-locked="' + locked + '" data-image="' + escapeHtml(imageUrl(recipe.cover_image_url)) + '" data-name="' + escapeHtml(recipe.title) + '">' +
      '<span class="recipe-row-index">' + String(index + 1).padStart(2, "0") + '</span>' +
      '<span class="recipe-row-title">' + (locked ? "Resep premium" : escapeHtml(recipe.title)) + '</span>' +
      '<span class="recipe-row-meta">' + (locked ? "AKSES TERBATAS" : ((recipe.prep_time_minutes || 20) + " MENIT · MUDAH")) + '</span>' +
      '<span class="recipe-row-price">' + (locked ? "🔒 TERKUNCI" : money(recipe.estimated_cost_idr)) + '</span>' +
      '<span class="recipe-row-arrow">' + (locked ? "🔒" : "↗") + '</span></button>';
  }).join("");

  const movePreview = (event) => {
    preview.style.left = Math.max(12, Math.min(window.innerWidth - 260, event.clientX + 24)) + "px";
    preview.style.top = Math.max(16, Math.min(window.innerHeight - 205, event.clientY - 90)) + "px";
  };
  const hidePreview = () => preview.classList.remove("visible");

  $("recipeGrid").querySelectorAll("[data-recipe]").forEach((row) => {
    if (row.dataset.locked !== "true") {
      row.addEventListener("mouseenter", (event) => {
        previewImage.src = row.dataset.image;
        previewLabel.textContent = row.dataset.name;
        preview.classList.add("visible");
        movePreview(event);
      });
      row.addEventListener("mousemove", movePreview);
      row.addEventListener("mouseleave", hidePreview);
      row.addEventListener("focus", () => {
        previewImage.src = row.dataset.image;
        previewLabel.textContent = row.dataset.name;
        const rect = row.getBoundingClientRect();
        preview.style.left = Math.max(12, Math.min(window.innerWidth - 260, rect.right + 18)) + "px";
        preview.style.top = Math.max(16, Math.min(window.innerHeight - 205, rect.top - 70)) + "px";
        preview.classList.add("visible");
      });
      row.addEventListener("blur", hidePreview);
    }
    row.addEventListener("click", () => {
      if (row.dataset.locked === "true") {
        openModal("subscriptionModal");
        return;
      }
      openRecipe(row.dataset.recipe);
    });
  });

  const toggle = $("toggleAllRecipes");
  toggle.classList.toggle("hidden", allRecipes.length <= 10);
  toggle.textContent = state.showAllRecipes ? "TAMPILKAN 10 RESEP PERTAMA ↑" : "LIHAT SEMUA RESEP ↗";
}

async function openRecipe(recipeId, options) {
  const recipe = state.recipes.find((item) => item.id === recipeId);
  if (!recipe) return;

  const canOpenPremium = state.isVip || state.recipeBookPurchased || (options?.fromMonthly && state.monthlyPlanPurchased);
  if (recipe.access_tier === "premium" && !canOpenPremium) {
    openModal("subscriptionModal");
    return;
  }

  $("recipeModalImage").src = imageUrl(recipe.cover_image_url);
  $("recipeModalImage").alt = recipe.title;
  $("recipeModalMeta").textContent = (recipe.prep_time_minutes || 20) + " MENIT · " + money(recipe.estimated_cost_idr) + " / PORSI";
  $("recipeTitle").textContent = recipe.title;
  $("recipeCalories").textContent = recipe.calories || 0;
  $("recipeProtein").textContent = (recipe.protein_g || 0) + "g";
  $("recipeCarbs").textContent = (recipe.carbs_g || 0) + "g";
  $("recipeFat").textContent = (recipe.fat_g || 0) + "g";
  $("recipeIngredients").innerHTML = "<li>Memuat bahan...</li>";
  $("recipeSteps").innerHTML = "<li>Memuat cara memasak...</li>";
  openModal("recipeModal");

  const [ingredientsResult, stepsResult] = await Promise.all([
    supabaseClient.from("recipe_ingredients")
      .select("quantity,unit,note,sort_order,ingredients(name,category)")
      .eq("recipe_id", recipeId)
      .order("sort_order"),
    supabaseClient.from("recipe_steps")
      .select("step_number,instruction")
      .eq("recipe_id", recipeId)
      .order("step_number")
  ]);

  if (ingredientsResult.error || stepsResult.error) {
    console.error("Recipe detail request failed:", ingredientsResult.error || stepsResult.error);
    toast("Detail resep belum bisa dimuat. Periksa akses paket atau koneksi.");
    $("recipeIngredients").innerHTML = "<li>Detail bahan tidak tersedia.</li>";
    $("recipeSteps").innerHTML = "<li>Detail memasak tidak tersedia.</li>";
    return;
  }

  const ingredientRows = ingredientsResult.data || [];
  const stepRows = stepsResult.data || [];
  $("recipeIngredients").innerHTML = ingredientRows.length
    ? ingredientRows.map((row) => {
        const ingredient = Array.isArray(row.ingredients) ? row.ingredients[0] : row.ingredients;
        const name = ingredient?.name || row.note || "Bahan";
        return "<li>" + escapeHtml(name) + " · " + Number(row.quantity).toLocaleString("id-ID") + " " + escapeHtml(row.unit) +
          (row.note ? " (" + escapeHtml(row.note) + ")" : "") + "</li>";
      }).join("")
    : "<li>Belum ada data bahan.</li>";
  $("recipeSteps").innerHTML = stepRows.length
    ? stepRows.map((row) => "<li>" + escapeHtml(row.instruction) + "</li>").join("")
    : "<li>Belum ada langkah memasak.</li>";
}

function categoryLabel(category) {
  return ({
    protein: "Protein",
    carbohydrate: "Karbohidrat",
    vegetable: "Sayuran",
    seasoning: "Bumbu",
    other: "Lainnya"
  })[category] || "Lainnya";
}

function aggregateIngredients(recipeItems, recipeIngredientRows) {
  const recipeServings = new Map(recipeItems.map((item) => [item.recipe_id, Number(item.servings || 1)]));
  const grouped = new Map();

  (recipeIngredientRows || []).forEach((row) => {
    const ingredient = Array.isArray(row.ingredients) ? row.ingredients[0] : row.ingredients;
    if (!ingredient) return;
    const key = row.ingredient_id + "|" + row.unit;
    const current = grouped.get(key) || {
      id: key,
      ingredient_id: row.ingredient_id,
      name: ingredient.name,
      category: ingredient.category,
      quantity: 0,
      unit: row.unit,
      is_checked: false
    };
    current.quantity += Number(row.quantity || 0) * (recipeServings.get(row.recipe_id) || 1);
    grouped.set(key, current);
  });

  return [...grouped.values()].sort((a, b) =>
    categoryLabel(a.category).localeCompare(categoryLabel(b.category), "id") ||
    a.name.localeCompare(b.name, "id")
  );
}

async function getIngredientRows(recipeItems) {
  const recipeIds = [...new Set(recipeItems.map((item) => item.recipe_id).filter(Boolean))];
  if (!recipeIds.length) return [];
  const { data, error } = await supabaseClient.from("recipe_ingredients")
    .select("recipe_id,ingredient_id,quantity,unit,ingredients(name,category)")
    .in("recipe_id", recipeIds)
    .order("sort_order");
  if (error) throw error;
  return data || [];
}

async function buildShoppingItems(recipeItems) {
  const rows = await getIngredientRows(recipeItems);
  return aggregateIngredients(recipeItems, rows);
}

async function loadOrCreateShoppingList() {
  state.shoppingListId = null;
  state.shoppingItems = [];
  if (!state.user || !state.weekPlan) {
    const guestItems = meals.map((meal) => ({ recipe_id: meal.id, servings: 1 }));
    state.shoppingItems = await buildShoppingItems(guestItems);
    renderShopping();
    return;
  }

  const weekStart = state.weekPlan.starts_on;
  const { data: existingList, error: listError } = await supabaseClient.from("shopping_lists")
    .select("id")
    .eq("user_id", state.user.id)
    .eq("week_start", weekStart)
    .maybeSingle();

  if (listError) throw listError;
  let list = existingList;
  if (!list) {
    const { data, error } = await supabaseClient.from("shopping_lists")
      .insert({
        user_id: state.user.id,
        meal_plan_id: state.weekPlan.id,
        name: "Daftar belanja mingguan",
        week_start: weekStart
      })
      .select("id")
      .single();
    if (error) throw error;
    list = data;
  }
  state.shoppingListId = list.id;

  let { data: rows, error: rowsError } = await supabaseClient.from("shopping_list_items")
    .select("id,ingredient_id,custom_name,quantity,unit,category,is_checked")
    .eq("shopping_list_id", list.id)
    .order("created_at");
  if (rowsError) throw rowsError;

  if (!rows || !rows.length) {
    const generated = await buildShoppingItems(state.weekItems.map((item) => ({
      recipe_id: item.recipe_id,
      servings: item.servings || 1
    })));
    if (generated.length) {
      const inserts = generated.map((item) => ({
        shopping_list_id: list.id,
        ingredient_id: item.ingredient_id,
        quantity: item.quantity,
        unit: item.unit,
        category: item.category
      }));
      const inserted = await supabaseClient.from("shopping_list_items").insert(inserts);
      if (inserted.error) throw inserted.error;
      const reloaded = await supabaseClient.from("shopping_list_items")
        .select("id,ingredient_id,custom_name,quantity,unit,category,is_checked")
        .eq("shopping_list_id", list.id)
        .order("created_at");
      if (reloaded.error) throw reloaded.error;
      rows = reloaded.data || [];
    }
  }

  state.shoppingItems = (rows || []).map((row) => ({
    id: row.id,
    ingredient_id: row.ingredient_id,
    name: row.custom_name || "Bahan",
    category: row.category || "other",
    quantity: Number(row.quantity || 0),
    unit: row.unit || "",
    is_checked: row.is_checked
  }));

  if (state.shoppingItems.length) {
    const ingredientIds = state.shoppingItems.map((item) => item.ingredient_id).filter(Boolean);
    if (ingredientIds.length) {
      const { data: names, error } = await supabaseClient.from("ingredients").select("id,name").in("id", ingredientIds);
      if (!error) {
        const nameById = new Map((names || []).map((item) => [item.id, item.name]));
        state.shoppingItems.forEach((item) => {
          if (item.ingredient_id && nameById.has(item.ingredient_id)) item.name = nameById.get(item.ingredient_id);
        });
      }
    }
  }
  renderShopping();
}

function renderShopping() {
  const categories = ["protein", "carbohydrate", "vegetable", "seasoning", "other"];
  const items = state.shoppingItems || [];
  const checked = items.filter((item) => item.is_checked).length;

  $("shoppingItems").innerHTML = categories.map((category) => {
    const categoryItems = items.filter((item) => item.category === category);
    if (!categoryItems.length) return "";
    return '<div class="shopping-group"><h4>' + categoryLabel(category) + '</h4><div class="shopping-group-items">' +
      categoryItems.map((item) => '<label class="shopping-item ' + (item.is_checked ? "checked" : "") + '">' +
        '<input type="checkbox" data-shop="' + escapeHtml(item.id) + '" ' + (item.is_checked ? "checked" : "") + '>' +
        '<span>' + escapeHtml(item.name) + '</span>' +
        '<small>' + Number(item.quantity).toLocaleString("id-ID") + " " + escapeHtml(item.unit) + '</small></label>'
      ).join("") + '</div></div>';
  }).join("");

  $("shoppingItems").querySelectorAll("[data-shop]").forEach((input) => {
    input.addEventListener("change", async () => {
      const item = state.shoppingItems.find((entry) => String(entry.id) === input.dataset.shop);
      if (!item) return;
      const oldValue = item.is_checked;
      item.is_checked = input.checked;
      renderShopping();
      if (state.user && state.shoppingListId && typeof item.id === "string" && item.id.includes("-")) {
        const { error } = await supabaseClient.from("shopping_list_items")
          .update({ is_checked: item.is_checked })
          .eq("id", item.id)
          .eq("shopping_list_id", state.shoppingListId);
        if (error) {
          item.is_checked = oldValue;
          renderShopping();
          toast("Status belanja gagal disimpan.");
        }
      }
    });
  });

  $("shoppingCount").textContent = checked + "/" + items.length;
  $("shoppingRemaining").textContent = (items.length - checked) + " BAHAN TERSISA";
  $("shoppingProgress").style.width = (items.length ? checked / items.length * 100 : 0) + "%";
}

async function rebuildShoppingList() {
  if (state.user && state.shoppingListId) {
    const { error } = await supabaseClient.from("shopping_list_items")
      .delete()
      .eq("shopping_list_id", state.shoppingListId);
    if (error) {
      toast("Daftar belanja gagal diperbarui.");
      return;
    }
    const generated = await buildShoppingItems(state.weekItems.map((item) => ({
      recipe_id: item.recipe_id,
      servings: item.servings || 1
    })));
    if (generated.length) {
      const { error: insertError } = await supabaseClient.from("shopping_list_items").insert(
        generated.map((item) => ({
          shopping_list_id: state.shoppingListId,
          ingredient_id: item.ingredient_id,
          quantity: item.quantity,
          unit: item.unit,
          category: item.category
        }))
      );
      if (insertError) {
        toast("Bahan baru gagal disimpan.");
        return;
      }
    }
    await loadOrCreateShoppingList();
  } else {
    state.shoppingItems = await buildShoppingItems(meals.map((meal) => ({ recipe_id: meal.id, servings: 1 })));
    renderShopping();
  }
}

async function loadProducts() {
  const { data, error } = await supabaseClient.from("products")
    .select("code,name,price_idr,duration_days,is_active,display_order")
    .eq("is_active", true)
    .order("display_order");
  if (error) throw error;
  state.products = data || [];
  state.productByCode = Object.fromEntries(state.products.map((product) => [product.code, product]));
  const priceText = (code) => state.productByCode[code] ? money(state.productByCode[code].price_idr) : "";

  document.querySelectorAll('[data-plan="monthly"] b').forEach((label) => {
    if (priceText("good_food_club_monthly")) label.textContent = priceText("good_food_club_monthly");
  });
  document.querySelectorAll('[data-plan="yearly"] b').forEach((label) => {
    if (priceText("good_food_club_yearly")) label.textContent = priceText("good_food_club_yearly");
  });

  const recipeBookOffer = $("buyRecipeBook")?.closest(".single-recipe-offer");
  if (recipeBookOffer && priceText("recipe_book_30")) recipeBookOffer.querySelector(".single-recipe-bottom b").innerHTML = priceText("recipe_book_30") + ' <small>/ sekali beli</small>';
  const monthlyOffer = $("buyMonthlyPlanFromOffers")?.closest(".single-recipe-offer");
  if (monthlyOffer && priceText("meal_plan_30_days")) monthlyOffer.querySelector(".single-recipe-bottom b").innerHTML = priceText("meal_plan_30_days") + ' <small>/ sekali beli</small>';
  if (priceText("meal_plan_30_days")) $("monthlyPlanModal").querySelector(".monthly-purchase-price b").textContent = priceText("meal_plan_30_days");
}

async function ensureWeeklyPlan() {
  const start = mondayIso();
  const end = addDaysIso(start, 6);
  const { data: plan, error: planError } = await supabaseClient.from("meal_plans")
    .upsert({
      user_id: state.user.id,
      plan_type: "weekly",
      title: "Rencana makan mingguan",
      starts_on: start,
      ends_on: end,
      weekly_budget_idr: state.budget,
      diet_preference: state.diet
    }, { onConflict: "user_id,plan_type,starts_on" })
    .select("id,user_id,plan_type,starts_on,ends_on,weekly_budget_idr,diet_preference")
    .single();
  if (planError) throw planError;
  state.weekPlan = plan;

  let { data: items, error: itemsError } = await supabaseClient.from("meal_plan_items")
    .select("id,meal_plan_id,recipe_id,planned_on,meal_slot,servings")
    .eq("meal_plan_id", plan.id)
    .order("planned_on");
  if (itemsError) throw itemsError;

  if (!items || !items.length) {
    const initialItems = state.recipes.slice(0, 7).map((recipe, index) => ({
      meal_plan_id: plan.id,
      recipe_id: recipe.id,
      planned_on: addDaysIso(start, index),
      meal_slot: "main",
      servings: 1
    }));
    if (initialItems.length) {
      const inserted = await supabaseClient.from("meal_plan_items").upsert(initialItems, {
        onConflict: "meal_plan_id,planned_on,meal_slot"
      });
      if (inserted.error) throw inserted.error;
      const reloaded = await supabaseClient.from("meal_plan_items")
        .select("id,meal_plan_id,recipe_id,planned_on,meal_slot,servings")
        .eq("meal_plan_id", plan.id)
        .order("planned_on");
      if (reloaded.error) throw reloaded.error;
      items = reloaded.data || [];
    }
  }

  state.weekItems = items || [];
  meals = state.weekItems.map((item) => {
    const recipe = state.recipes.find((entry) => entry.id === item.recipe_id);
    return recipe ? recipeAsMeal(recipe, item.planned_on, item.servings) : null;
  }).filter(Boolean);
}

async function ensureMonthlyPlan() {
  if (!state.user || (!state.isVip && !state.monthlyPlanPurchased)) {
    state.monthlyPlan = null;
    state.monthlyItems = [];
    return;
  }

  const start = state.monthlyPlan?.starts_on || todayIso();
  const end = addDaysIso(start, 29);
  const { data: plan, error: planError } = await supabaseClient.from("meal_plans")
    .upsert({
      user_id: state.user.id,
      plan_type: "monthly",
      title: "Meal Plan Bulanan · 30 Hari",
      starts_on: start,
      ends_on: end,
      weekly_budget_idr: state.budget,
      diet_preference: state.diet
    }, { onConflict: "user_id,plan_type,starts_on" })
    .select("id,user_id,plan_type,starts_on,ends_on")
    .single();
  if (planError) throw planError;
  state.monthlyPlan = plan;

  let { data: items, error: itemsError } = await supabaseClient.from("meal_plan_items")
    .select("id,meal_plan_id,recipe_id,planned_on,meal_slot,servings")
    .eq("meal_plan_id", plan.id)
    .order("planned_on");
  if (itemsError) throw itemsError;

  if (!items || !items.length) {
    const generated = Array.from({ length: 30 }, (_, index) => ({
      meal_plan_id: plan.id,
      recipe_id: state.recipes[index % state.recipes.length].id,
      planned_on: addDaysIso(start, index),
      meal_slot: "main",
      servings: 1
    }));
    const inserted = await supabaseClient.from("meal_plan_items").upsert(generated, {
      onConflict: "meal_plan_id,planned_on,meal_slot"
    });
    if (inserted.error) throw inserted.error;
    const reloaded = await supabaseClient.from("meal_plan_items")
      .select("id,meal_plan_id,recipe_id,planned_on,meal_slot,servings")
      .eq("meal_plan_id", plan.id)
      .order("planned_on");
    if (reloaded.error) throw reloaded.error;
    items = reloaded.data || [];
  }
  state.monthlyItems = items || [];
}

function renderMonthlyCalendar() {
  const canView = state.isVip || state.monthlyPlanPurchased;
  const monthItems = state.monthlyItems || [];
  const start = state.monthlyPlan?.starts_on || todayIso();
  const firstDate = new Date(start + "T12:00:00");
  const offset = firstDate.getDay();
  const labels = ["MIN", "SEN", "SEL", "RAB", "KAM", "JUM", "SAB"];
  $("calendarMonthTitle").textContent = canView
    ? dateLabel(start, { day: "numeric", month: "long" }) + " – 30 hari"
    : "Meal Plan Bulanan";
  let cells = labels.map((day) => '<div class="calendar-weekday">' + day + '</div>').join("");
  for (let i = 0; i < offset; i++) cells += '<div class="calendar-empty"></div>';

  for (let day = 0; day < 30; day++) {
    const item = monthItems[day];
    const recipe = item && state.recipes.find((entry) => entry.id === item.recipe_id);
    const locked = !canView || !item || !recipe;
    cells += '<button class="calendar-day ' + (locked ? "calendar-day-locked" : "") + '" data-calendar-day="' + day + '">' +
      '<span>' + (day + 1) + '</span>' +
      '<b>' + (locked ? "Menu terkunci" : escapeHtml(recipe.title)) + '</b>' +
      '<small>' + (locked ? "AKSES BULANAN" : money(recipe.estimated_cost_idr)) + '</small></button>';
  }

  $("monthlyCalendar").innerHTML = cells;
  $("monthlyCalendar").querySelectorAll("[data-calendar-day]").forEach((button) => {
    button.addEventListener("click", () => {
      if (!canView) {
        openModal("monthlyPlanModal");
        return;
      }
      const dayIndex = Number(button.dataset.calendarDay);
      const item = monthItems[dayIndex];
      const recipe = item && state.recipes.find((entry) => entry.id === item.recipe_id);
      if (!recipe) return;
      const meal = recipeAsMeal(recipe, item.planned_on, item.servings);
      showMealDetail(meal, "HARI KE-" + (dayIndex + 1) + " · " + dateLabel(item.planned_on, { day: "numeric", month: "long" }).toUpperCase(), true);
    });
  });

  $("monthlyPlanLocked").classList.toggle("hidden", canView);
  $("monthlyCalendar").classList.toggle("calendar-blurred", !canView);
}

function showMonthly() {
  if (!state.isVip && !state.monthlyPlanPurchased) {
    openModal("monthlyPlanModal");
    return;
  }
  $("weekGrid").classList.add("hidden");
  $("monthlyCalendarWrap").classList.remove("hidden");
  $("showMonthlyPlan").classList.add("hidden");
  renderMonthlyCalendar();
}

function showWeekly() {
  $("weekGrid").classList.remove("hidden");
  $("monthlyCalendarWrap").classList.add("hidden");
  $("showMonthlyPlan").classList.remove("hidden");
}

async function loadProfileAndEntitlements(user) {
  let { data: profile, error: profileError } = await supabaseClient.from("profiles")
    .select("id,full_name,avatar_url,weekly_budget_idr,diet_preference")
    .eq("id", user.id)
    .maybeSingle();
  if (profileError) throw profileError;
  if (!profile) {
    const created = await supabaseClient.from("profiles").upsert({
      id: user.id,
      full_name: user.user_metadata?.full_name || (user.email || "").split("@")[0] || "Member"
    }).select("id,full_name,avatar_url,weekly_budget_idr,diet_preference").single();
    if (created.error) throw created.error;
    profile = created.data;
  }

  const { data: entitlements, error: entitlementError } = await supabaseClient.from("user_entitlements")
    .select("entitlement_code,status,starts_at,expires_at")
    .eq("user_id", user.id);
  if (entitlementError) throw entitlementError;

  state.profile = profile;
  state.entitlements = entitlements || [];
  state.budget = Number(profile.weekly_budget_idr || 120000);
  state.diet = profile.diet_preference || "all";
  syncEntitlementFlags();
  document.querySelectorAll("[data-diet]").forEach((button) => button.classList.toggle("active", button.dataset.diet === state.diet));
}

async function loadUserData(user) {
  state.user = user;
  await loadProfileAndEntitlements(user);
  await ensureWeeklyPlan();
  await ensureMonthlyPlan();
  await loadOrCreateShoppingList();
  updateHeader();
  renderBudget();
  renderPlanner();
  renderRecipes();
  renderMonthlyCalendar();
  $("weeklyLockedNotice").classList.toggle("hidden", state.isVip);
  if (meals.length) selectDay(Math.min(state.selectedDay, meals.length - 1));
}

async function loadGuestData() {
  state.user = null;
  state.profile = null;
  state.entitlements = [];
  state.isVip = false;
  state.recipeBookPurchased = false;
  state.monthlyPlanPurchased = false;
  state.weekPlan = null;
  state.weekItems = [];
  state.monthlyPlan = null;
  state.monthlyItems = [];
  state.shoppingListId = null;
  state.budget = 120000;
  state.diet = "all";
  const start = mondayIso();
  meals = state.recipes.slice(0, 7).map((recipe, index) => recipeAsMeal(recipe, addDaysIso(start, index), 1));
  await loadOrCreateShoppingList();
  document.querySelectorAll("[data-diet]").forEach((button) => button.classList.toggle("active", button.dataset.diet === "all"));
  updateHeader();
  renderBudget();
  renderPlanner();
  renderRecipes();
  renderMonthlyCalendar();
  $("weeklyLockedNotice").classList.remove("hidden");
  if (meals.length) selectDay(0);
}

async function handleAuthSession(session) {
  const user = session?.user || null;
  if (!user) {
    if (!state.user && currentUserLoadId === null) return;
    currentUserLoadId = null;
    await loadGuestData();
    return;
  }
  if (currentUserLoadId === user.id) return;
  currentUserLoadId = user.id;
  try {
    await loadUserData(user);
    toast("Data akun berhasil dimuat.");
  } catch (error) {
    console.error("Account loading failed:", error);
    currentUserLoadId = null;
    toast("Data akun belum bisa dimuat. Coba refresh halaman.");
  }
}

function updateHeader() {
  const header = $("headerActions");
  if (!state.user) {
    header.innerHTML = '<button class="button button-quiet" data-auth="login">Masuk</button><button class="button button-small button-gold" data-auth="register">Daftar ↗</button>';
    header.querySelectorAll("[data-auth]").forEach((button) => {
      button.addEventListener("click", () => openAuth(button.dataset.auth));
    });
    return;
  }

  const name = state.profile?.full_name || state.user.user_metadata?.full_name || (state.user.email || "Member").split("@")[0];
  header.innerHTML = '<div class="profile-wrap"><button class="profile-button" id="profileButton"><span>' +
    escapeHtml(name.slice(0, 2).toUpperCase()) + '</span> Hai, ' + escapeHtml(name) +
    '⌄</button><div class="profile-menu hidden" id="profileMenu"><b>' + escapeHtml(name) +
    '</b><small>' + escapeHtml(state.user.email) + '</small><small>' +
    (state.isVip ? "THE GOOD FOOD CLUB" : state.recipeBookPurchased ? "RECIPE BOOK OWNER" : state.monthlyPlanPurchased ? "MONTHLY PLAN OWNER" : "FREE MEMBER") +
    '</small><button id="profileDetails">Profil saya</button><button id="logoutButton">Keluar</button></div></div>';
  $("profileButton").onclick = () => $("profileMenu").classList.toggle("hidden");
  $("profileDetails").onclick = () => toast("Profil " + name + " · " + state.user.email);
  $("logoutButton").onclick = async () => {
    const { error } = await supabaseClient.auth.signOut();
    if (error) toast("Gagal keluar. " + error.message);
  };
}

function openAuth(mode) {
  state.authMode = mode;
  $("nameField").classList.toggle("hidden", mode !== "register");
  $("authName").required = mode === "register";
  $("authTitle").textContent = mode === "login" ? "Senang melihatmu lagi." : "Mulai makan lebih baik.";
  $("authIntro").textContent = mode === "login" ? "Masuk dan lanjutkan rencana makanmu." : "Buat akun agar rencana makan dan daftar belanja tersimpan.";
  $("authSubmit").textContent = mode === "login" ? "MASUK KE ICAMEAL ↗" : "BUAT AKUN ↗";
  $("authSwitch").innerHTML = mode === "login"
    ? 'Belum punya akun? <button type="button" data-auth-switch>Daftar sekarang</button>'
    : 'Sudah punya akun? <button type="button" data-auth-switch>Masuk</button>';
  $("authSwitch").querySelector("button").onclick = () => openAuth(mode === "login" ? "register" : "login");
  openModal("authModal");
}

async function submitAuth(event) {
  event.preventDefault();
  const button = $("authSubmit");
  const email = $("authEmail").value.trim();
  const password = $("authPassword").value;
  const name = state.authMode === "register" ? $("authName").value.trim() : "";
  if (password.length < 8) {
    toast("Password minimal 8 karakter.");
    return;
  }

  button.disabled = true;
  button.textContent = state.authMode === "login" ? "MEMASUKKAN..." : "MEMBUAT AKUN...";
  try {
    if (state.authMode === "register") {
      const { data, error } = await supabaseClient.auth.signUp({
        email,
        password,
        options: { data: { full_name: name } }
      });
      if (error) throw error;
      if (!data.session) {
        $("authIntro").textContent = "Akun berhasil dibuat. Periksa email untuk verifikasi sebelum masuk.";
        toast("Cek email untuk verifikasi akun IcaMeal.");
        return;
      }
      closeModal("authModal");
      await handleAuthSession(data.session);
      toast("Akun IcaMeal berhasil dibuat.");
    } else {
      const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
      if (error) throw error;
      closeModal("authModal");
      await handleAuthSession(data.session);
      toast("Selamat datang kembali.");
    }
  } catch (error) {
    toast(error.message || "Autentikasi gagal.");
  } finally {
    button.disabled = false;
    button.textContent = state.authMode === "login" ? "MASUK KE ICAMEAL ↗" : "BUAT AKUN ↗";
  }
}

async function saveProfile(patch) {
  if (!state.user) return;
  const { error } = await supabaseClient.from("profiles").update(patch).eq("id", state.user.id);
  if (error) {
    toast("Preferensi belum berhasil disimpan.");
    return;
  }
  state.profile = { ...(state.profile || {}), ...patch };
  if (state.weekPlan) {
    await supabaseClient.from("meal_plans").update({
      weekly_budget_idr: state.budget,
      diet_preference: state.diet
    }).eq("id", state.weekPlan.id);
  }
}

async function purchaseProduct(productCode) {
  if (!state.user) {
    toast("Masuk atau daftar dulu untuk menyimpan pembelian.");
    openAuth("login");
    return;
  }
  try {
    const { data, error } = await supabaseClient.functions.invoke("demo-checkout", {
      body: { product_code: productCode }
    });
    if (error) throw error;
    if (!data?.ok) throw new Error(data?.error || "Pembelian demo gagal.");
    closeModal("subscriptionModal");
    closeModal("monthlyPlanModal");
    currentUserLoadId = null;
    const { data: sessionData } = await supabaseClient.auth.getSession();
    await handleAuthSession(sessionData.session);
    if (productCode === "meal_plan_30_days") showMonthly();
    toast("Pembelian simulasi berhasil. Akses paket sudah tersimpan di akun.");
  } catch (error) {
    console.error("Checkout failed:", error);
    toast(error.message || "Pembelian belum bisa diproses.");
  }
}

async function regenerateWeeklyPlan() {
  if (!state.recipes.length) return;
  if (!state.weekPlan || !state.user) {
    const current = meals[0]?.id;
    const currentIndex = state.recipes.findIndex((recipe) => recipe.id === current);
    const offset = (currentIndex + 1) % state.recipes.length;
    const start = mondayIso();
    meals = Array.from({ length: 7 }, (_, index) =>
      recipeAsMeal(state.recipes[(offset + index) % state.recipes.length], addDaysIso(start, index), 1)
    );
    state.selectedDay = 0;
    renderPlanner();
    try {
      await rebuildShoppingList();
    } catch (error) {
      toast("Daftar belanja gagal dihitung.");
    }
    selectDay(0);
    toast("Rekomendasi menu diperbarui.");
    return;
  }

  try {
    const currentIndex = state.recipes.findIndex((recipe) => recipe.id === state.weekItems[0]?.recipe_id);
    const offset = (currentIndex + 1) % state.recipes.length;
    const rows = Array.from({ length: 7 }, (_, index) => ({
      meal_plan_id: state.weekPlan.id,
      recipe_id: state.recipes[(offset + index) % state.recipes.length].id,
      planned_on: addDaysIso(state.weekPlan.starts_on, index),
      meal_slot: "main",
      servings: 1
    }));
    const deletion = await supabaseClient.from("meal_plan_items").delete().eq("meal_plan_id", state.weekPlan.id);
    if (deletion.error) throw deletion.error;
    const insertion = await supabaseClient.from("meal_plan_items").insert(rows);
    if (insertion.error) throw insertion.error;
    await ensureWeeklyPlan();
    await rebuildShoppingList();
    state.selectedDay = 0;
    renderPlanner();
    selectDay(0);
    toast("Rencana mingguan berhasil disusun ulang.");
  } catch (error) {
    toast("Rencana mingguan gagal diperbarui: " + error.message);
  }
}

function openModal(id) {
  $(id).classList.remove("hidden");
}
function closeModal(id) {
  $(id).classList.add("hidden");
}

function bindEvents() {
  document.querySelectorAll("[data-auth]").forEach((button) => {
    button.addEventListener("click", () => openAuth(button.dataset.auth));
  });
  document.querySelectorAll("[data-close]").forEach((button) => {
    button.addEventListener("click", () => closeModal(button.dataset.close));
  });
  document.querySelectorAll(".modal-backdrop").forEach((backdrop) => {
    backdrop.addEventListener("click", (event) => {
      if (event.target === backdrop) closeModal(backdrop.id);
    });
  });
  document.querySelectorAll("[data-subscribe]").forEach((button) => {
    button.addEventListener("click", () => openModal("subscriptionModal"));
  });
  document.querySelectorAll("[data-plan]").forEach((button) => {
    button.addEventListener("click", () => {
      state.plan = button.dataset.plan;
      document.querySelectorAll("[data-plan]").forEach((item) => {
        item.classList.toggle("selected", item.dataset.plan === state.plan);
      });
    });
  });

  $("authForm").addEventListener("submit", submitAuth);
  $("activateMembership").onclick = () => purchaseProduct(state.plan === "yearly" ? "good_food_club_yearly" : "good_food_club_monthly");
  $("buyRecipeBook").onclick = () => purchaseProduct("recipe_book_30");
  $("buyMonthlyPlan").onclick = () => purchaseProduct("meal_plan_30_days");
  $("buyMonthlyPlanFromOffers").onclick = () => purchaseProduct("meal_plan_30_days");
  $("showMonthlyPlan").onclick = showMonthly;
  $("showWeeklyPlan").onclick = showWeekly;
  $("toggleAllRecipes").onclick = () => {
    state.showAllRecipes = !state.showAllRecipes;
    renderRecipes();
  };
  document.querySelectorAll("[data-monthly-purchase]").forEach((button) => {
    button.addEventListener("click", () => openModal("monthlyPlanModal"));
  });

  $("budgetInput").addEventListener("change", async (event) => {
    state.budget = Math.min(500000, Math.max(50000, Number(event.target.value) || 50000));
    renderBudget();
    await saveProfile({ weekly_budget_idr: state.budget });
  });
  $("budgetRange").addEventListener("change", async (event) => {
    state.budget = Number(event.target.value);
    renderBudget();
    await saveProfile({ weekly_budget_idr: state.budget });
  });
  document.querySelectorAll("[data-budget]").forEach((button) => {
    button.addEventListener("click", async () => {
      state.budget = Number(button.dataset.budget);
      renderBudget();
      await saveProfile({ weekly_budget_idr: state.budget });
    });
  });
  document.querySelectorAll("[data-diet]").forEach((button) => {
    button.addEventListener("click", async () => {
      state.diet = button.dataset.diet;
      document.querySelectorAll("[data-diet]").forEach((item) => {
        item.classList.toggle("active", item === button);
      });
      renderBudget();
      renderPlanner();
      await saveProfile({ diet_preference: state.diet });
    });
  });
  $("regeneratePlan").onclick = regenerateWeeklyPlan;
  $("copyShopping").onclick = async () => {
    const text = state.shoppingItems.map((item) =>
      "- " + item.name + " · " + Number(item.quantity).toLocaleString("id-ID") + " " + item.unit
    ).join("\n");
    try {
      await navigator.clipboard.writeText(text);
      toast("Daftar belanja berhasil disalin.");
    } catch {
      toast("Browser tidak mengizinkan akses clipboard.");
    }
  };
  $("mobileMenu").onclick = () => document.querySelector(".main-nav").classList.toggle("open");
  document.querySelectorAll(".main-nav a").forEach((link) => {
    link.addEventListener("click", () => document.querySelector(".main-nav").classList.remove("open"));
  });
}

async function loadCatalog() {
  const { data, error } = await supabaseClient.from("recipes")
    .select("*")
    .eq("is_published", true)
    .order("sort_order");
  if (error) throw error;
  state.recipes = data || [];
  if (!state.recipes.length) throw new Error("Katalog resep belum tersedia.");
}

async function initApp() {
  if (!supabaseClient) {
    toast("Supabase client tidak berhasil dimuat. Periksa koneksi CDN.");
    return;
  }

  bindEvents();

  try {
    await loadCatalog();
    await loadProducts();
    initHeroMotion();

    const { data: sessionData, error: sessionError } = await supabaseClient.auth.getSession();
    if (sessionError) throw sessionError;
    if (sessionData.session) {
      await handleAuthSession(sessionData.session);
    } else {
      await loadGuestData();
    }

    supabaseClient.auth.onAuthStateChange((event, session) => {
      if (event === "TOKEN_REFRESHED" || event === "INITIAL_SESSION") return;
      window.setTimeout(() => handleAuthSession(session), 0);
    });
  } catch (error) {
    console.error("IcaMeal initialization failed:", error);
    toast("IcaMeal gagal memuat data. " + (error.message || "Periksa koneksi."));
  }
}

initApp();

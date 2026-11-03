import { findIdsByKeyword } from '../../helpers/atlas-search.helper';
import CategoryProduct from '../../models/category-product.model';
import Product from '../../models/product.model';
import Review from '../../models/review.model';
import AccountUser from '../../models/account-user.model';
import { formatProductItem } from '../../helpers/product.helper';
import { PAGINATION } from '../../configs/pagination.config';
import { PRODUCT_DISPLAY_CONFIG } from '../../configs/product-display.config';
import { RECOMMENDATION_CONFIG } from '../../configs/recommendation.config';
import { FEATURES } from '../../configs/features.config';
import { getPagination } from '../../helpers/pagination.helper';
import { IAccountUser } from '../../interfaces/models/account-user.interface';
import { ICategoryProduct } from '../../interfaces/models/category-product.interface';
import { IAttributeProduct } from '../../interfaces/models/attribute-product.interface';
import { IProduct } from '../../interfaces/models/product.interface';
import { IReview } from '../../interfaces/models/review.interface';
import { metadataCache, invalidateProductCaches } from '../../helpers/metadata-cache.helper';
import { getActiveAttributes } from '../admin/attribute-product.service';

const MAX_LIMIT_ITEMS = 60;

export interface ProductFilterQuery {
  page?: unknown;
  limitItems?: unknown;
  keyword?: unknown;
  price?: unknown;
  onSale?: unknown;
  inStock?: unknown;
  rating?: unknown;
  sort?: unknown;
  [key: string]: unknown;
}

export const searchProductIds = (keyword: string, limit = 2000) =>
  findIdsByKeyword({ model: Product, keyword, atlasPaths: ["name", "description"], limit }).catch(() => [] as string[]);

// Keeps the search engine's best-match-first order for the records that passed the other filters,
// with sold-out products moved after the ones that can be bought.
const orderByRelevance = (rankedIds: string[], visible: Array<{ _id: unknown; stock?: number | null }>): string[] => {
  const stockById = new Map(visible.map((doc) => [String(doc._id), doc.stock ?? 0]));
  const ranked = rankedIds.filter((id) => stockById.has(id));
  return [
    ...ranked.filter((id) => (stockById.get(id) ?? 0) > 0),
    ...ranked.filter((id) => (stockById.get(id) ?? 0) <= 0)
  ];
};

export const sortByIdOrder = <T extends { _id: unknown }>(list: T[], ids: string[]): T[] => {
  const position = new Map(ids.map((id, index) => [id, index]));
  return [...list].sort((a, b) => (position.get(String(a._id)) ?? 0) - (position.get(String(b._id)) ?? 0));
};

export const getProductsByCategory = async (
  slug?: string,
  query: ProductFilterQuery = {}
) => {
  let categoryDetail: ICategoryProduct | { id: string; name: string; slug: string } | null = null;

  if (slug) {
    const catCacheKey = `category:slug:${slug}`;
    categoryDetail = metadataCache.get<ICategoryProduct>(catCacheKey) || null;
    if (!categoryDetail) {
      categoryDetail = await CategoryProduct.findOne({
        slug: slug,
        deleted: false,
        status: "active"
      });
      if (categoryDetail) {
        metadataCache.set(catCacheKey, categoryDetail, 600);
      }
    }
  } else {
    categoryDetail = {
      id: "",
      name: "All Products",
      slug: ""
    };
  }

  if (!categoryDetail) return null;

  const isDefaultBrowse =
    !query.keyword &&
    !query.price &&
    !query.onSale &&
    !query.inStock &&
    !query.rating &&
    !query.sort &&
    !Object.keys(query).some((k) => k.startsWith("attribute_"));

  const pageNum = query.page ? parseInt(String(query.page)) || 1 : 1;
  const catalogCacheKey = isDefaultBrowse ? `catalog:${slug || "all"}:p${pageNum}` : null;

  if (catalogCacheKey) {
    const cachedCatalog = metadataCache.get<{
      categoryDetail: ICategoryProduct | { id: string; name: string; slug: string };
      productList: IProduct[];
      pagination: ReturnType<typeof getPagination>;
      topRatedProducts: IProduct[];
    }>(catalogCacheKey);
    if (cachedCatalog) return cachedCatalog;
  }

  const find: Record<string, unknown> = {
    deleted: false,
    status: "active",
  };

  const categoryId = '_id' in categoryDetail && categoryDetail._id ? String(categoryDetail._id) : (categoryDetail as { id?: string }).id;
  if (categoryId) {
    find.category = categoryId;
  }

  const keyword = `${query.keyword || ""}`.trim().slice(0, 100);
  const rankedIds = keyword ? await searchProductIds(keyword) : [];
  if (keyword) {
    find._id = { $in: rankedIds };
  }
  // A keyword search is ordered best match first unless the shopper picks another sort.
  const sortByRelevance = Boolean(keyword) && (!query.sort || query.sort === "relevance");

  if (query.price) {
    const [priceMin, priceMax] = `${query.price}`.split("-").map(item => parseFloat(item));
    if (Number.isFinite(priceMin) && Number.isFinite(priceMax)) {
      find.priceNew = {
        $gte: priceMin,
        $lte: priceMax
      };
    }
  }

  if (query.onSale && query.onSale === "true") {
    find.discount = { $gt: 0 };
  }

  if (query.inStock && query.inStock === "true") {
    find.stock = { $gt: 0 };
  }

  const andConditions: Record<string, unknown>[] = [];

  const attributeFilters: Record<string, unknown>[] = [];
  Object.keys(query).forEach(key => {
    if (key.startsWith("attribute_")) {
      const attrId = key.replace("attribute_", "");
      const values = `${query[key]}`.split(",");
      attributeFilters.push({
        variants: {
          $elemMatch: {
            status: true,
            attributeValue: {
              $elemMatch: {
                attrId: attrId,
                value: { $in: values }
              }
            }
          }
        }
      });
    }
  });

  if (attributeFilters.length > 0) {
    andConditions.push(...attributeFilters);
  }

  if (query.rating) {
    const ratings = `${query.rating}`
      .split(",")
      .map((r) => parseInt(r))
      .filter((r) => !isNaN(r) && r >= 1 && r <= 5);
    if (ratings.length > 0) {
      const ratingOr = ratings.map((star) => ({
        ratingAvg: {
          $gte: star,
          $lt: star + 1
        }
      }));
      andConditions.push({ $or: ratingOr });
    }
  }

  if (andConditions.length > 0) {
    find.$and = andConditions;
  }

  let limitItems = PAGINATION.CLIENT_LIMIT;
  if (query.limitItems) {
    const currentLimitItems = parseInt(`${query.limitItems}`);
    if (currentLimitItems > 0) limitItems = Math.min(currentLimitItems, MAX_LIMIT_ITEMS);
  }

  const relevanceOrder = sortByRelevance
    ? orderByRelevance(rankedIds, await Product.find(find).select("_id stock"))
    : [];
  const totalRecord = sortByRelevance ? relevanceOrder.length : await Product.countDocuments(find);
  const pagination = getPagination(query.page, limitItems, totalRecord);

  const sort: Record<string, 1 | -1 | "asc" | "desc"> = {};
  if (query.sort) {
    const [sortKey, rawSortValue] = `${query.sort}`.split("-");
    const sortValue = rawSortValue === "asc" || rawSortValue === "1" ? "asc" : "desc";
    switch (sortKey) {
      case "position":
        sort.position = sortValue as 1 | -1 | "asc" | "desc";
        break;
      case "price":
        sort.priceNew = sortValue as 1 | -1 | "asc" | "desc";
        sort.position = sortValue as 1 | -1 | "asc" | "desc";
        break;
      case "createdAt":
        sort.createdAt = sortValue as 1 | -1 | "asc" | "desc";
        break;
      case "discount":
        sort.discount = sortValue as 1 | -1 | "asc" | "desc";
        sort.position = sortValue as 1 | -1 | "asc" | "desc";
        break;
      default:
        sort.position = "desc";
        break;
    }
  } else {
    sort.position = "desc";
  }

  const categoryTopRatedFind: Record<string, unknown> = {
    deleted: false,
    status: "active",
    ratingAvg: { $gte: 4 }
  };
  if (categoryId) {
    categoryTopRatedFind.category = categoryId;
  }

  const topRatedCacheKey = `product:top_rated:${categoryId || 'all'}`;
  let topRatedProducts = metadataCache.get<IProduct[]>(topRatedCacheKey);

  const pageIds = relevanceOrder.slice(pagination.skip, pagination.skip + limitItems);
  const productListPromise = sortByRelevance
    ? Product.find({ _id: { $in: pageIds } })
      .select("_id name slug images priceNew priceOld discount variants ratingAvg ratingCount")
      .then((list) => sortByIdOrder(list, pageIds))
    : Product.find(find)
      .select("_id name slug images priceNew priceOld discount variants ratingAvg ratingCount")
      .limit(limitItems)
      .skip(pagination.skip)
      .sort(sort);

  if (!topRatedProducts) {
    let topRated = await Product.find(categoryTopRatedFind)
      .select("_id name slug images priceNew priceOld discount variants ratingAvg ratingCount")
      .sort({ ratingAvg: "desc" })
      .limit(PRODUCT_DISPLAY_CONFIG.TOP_RATED_SIDEBAR_LIMIT);
    if (topRated.length === 0) {
      topRated = await Product.find({ deleted: false, status: "active", ratingAvg: { $gte: 4 } })
        .select("_id name slug images priceNew priceOld discount variants ratingAvg ratingCount")
        .sort({ ratingAvg: "desc" })
        .limit(PRODUCT_DISPLAY_CONFIG.TOP_RATED_SIDEBAR_LIMIT);
    }
    topRatedProducts = topRated;
    metadataCache.set(topRatedCacheKey, topRatedProducts, 300);
  }

  const productList = await productListPromise;


  for (const item of productList) {
    formatProductItem(item);
  }
  for (const item of topRatedProducts) {
    formatProductItem(item);
  }

  const result = {
    categoryDetail,
    productList,
    pagination,
    topRatedProducts
  };

  if (catalogCacheKey) {
    metadataCache.set(catalogCacheKey, result, 120);
  }

  return result;
};

export const getProductSuggestions = async (rawKeyword?: unknown) => {
  const keywordStr = `${rawKeyword || ""}`.trim().slice(0, 100);
  if (!keywordStr) return [];
  const cacheKey = `suggestions:${keywordStr.toLowerCase()}`;
  const cached = metadataCache.get<IProduct[]>(cacheKey);
  if (cached) return cached;

  // Same engine and order as the results page, so the dropdown previews exactly what Enter will show.
  const rankedIds = await searchProductIds(keywordStr, 200);
  const visible = await Product.find({
    _id: { $in: rankedIds },
    deleted: false,
    status: "active",
    priceNew: { $gt: 0 }
  }).select("_id stock");
  const topIds = orderByRelevance(rankedIds, visible).slice(0, PRODUCT_DISPLAY_CONFIG.SEARCH_SUGGESTION_LIMIT);

  const results = sortByIdOrder(
    await Product.find({ _id: { $in: topIds } }).select("images name slug priceNew priceOld discount stock"),
    topIds
  );

  metadataCache.set(cacheKey, results, 60);
  return results;
};

export const getProductDetailBySlug = async (slug: string, productViewHistory: string[] = []) => {
  const detailCacheKey = `product:detail:${slug}`;
  let cachedDetail = metadataCache.get<{
    productDetail: IProduct;
    attributeList: IAttributeProduct[];
    relatedProducts: IProduct[];
    boughtTogetherProducts: IProduct[];
    reviewList: IReview[];
  }>(detailCacheKey);

  if (!cachedDetail) {
    const productDoc = await Product.findOne({
      slug: slug,
      deleted: false,
      status: "active"
    });

    if (!productDoc) return null;

    const productDetail = productDoc.toObject({ virtuals: true }) as unknown as IProduct;

    const attributeIdSet = new Set((productDetail.attributes || []).map((a) => String(a)));
    const allActiveAttrs = await getActiveAttributes();
    const attributeList: IAttributeProduct[] = allActiveAttrs
      .filter((attr) => attributeIdSet.has(String(attr._id)))
      .map((attr) => {
        const item = (typeof (attr as unknown as { toObject?: () => IAttributeProduct }).toObject === "function"
          ? (attr as unknown as { toObject: () => IAttributeProduct }).toObject()
          : { ...(attr as unknown as Record<string, unknown>) }) as IAttributeProduct;
        item.id = String(attr._id);
        item.variants = [];
        item.variantsLabel = [];
        return item;
      });

    for (const attribute of attributeList) {
      const optionMap = new Map<string, string>();
      (productDetail.variants || [])
        .filter((variant) => variant.status)
        .forEach((variant) => {
          (variant.attributeValue || []).forEach((attr) => {
            if (String(attr.attrId) === String(attribute._id) && attr.value) {
              if (!optionMap.has(attr.value)) {
                optionMap.set(attr.value, attr.label || attr.value);
              }
            }
          });
        });
      attribute.variants = Array.from(optionMap.keys());
      attribute.variantsLabel = Array.from(optionMap.values());
    }

    const categoryList = await CategoryProduct
      .find({ _id: { $in: productDetail.category }, deleted: false, status: "active" })
      .select("name slug");
    productDetail.categoryList = categoryList.map((c) => ({
      _id: c._id,
      name: c.name ?? "",
      slug: c.slug ?? ""
    }));

    const usingCfFallback = !productDetail.boughtTogether || productDetail.boughtTogether.length === 0;
    const cfIds = usingCfFallback && FEATURES.RECOMMENDATIONS
      ? (productDetail.cfRecommendations || []).map((r) => r.productId)
      : [];
    const boughtTogetherIds = usingCfFallback ? cfIds : productDetail.boughtTogether;

    const [relatedProducts, boughtTogetherProductsRaw, reviewList] = await Promise.all([
      Product.find({
        _id: { $ne: productDetail.id },
        category: { $in: productDetail.category },
        deleted: false,
        status: "active"
      })
        .select("_id name slug images priceNew priceOld discount variants ratingAvg ratingCount")
        .sort({ view: "desc" })
        .limit(PRODUCT_DISPLAY_CONFIG.RELATED_PRODUCTS_LIMIT),
      usingCfFallback
        ? Product.find({
            _id: { $in: boughtTogetherIds },
            deleted: false,
            status: "active"
          })
            .select("_id name slug images priceNew priceOld discount variants ratingAvg ratingCount")
            .limit(RECOMMENDATION_CONFIG.TOP_N)
        : Product.find({
            _id: { $in: boughtTogetherIds },
            deleted: false,
            status: "active"
          })
            .select("_id name slug images priceNew priceOld discount variants ratingAvg ratingCount")
            .sort({ position: "desc" })
            .limit(PRODUCT_DISPLAY_CONFIG.BOUGHT_TOGETHER_LIMIT),
      Review.find({ productId: productDetail.id, status: { $ne: "rejected" } })
        .select("userId rating comment images reportCount reportedBy createdAt")
        .sort({ createdAt: "desc" })
    ]);

    const cfBoughtTogetherProducts = usingCfFallback
      ? (cfIds
          .map((id) => boughtTogetherProductsRaw.find((p) => String(p.id) === String(id)))
          .filter((p) => Boolean(p)) as typeof boughtTogetherProductsRaw
        ).slice(0, PRODUCT_DISPLAY_CONFIG.BOUGHT_TOGETHER_LIMIT)
      : boughtTogetherProductsRaw;

    const boughtTogetherProducts =
      usingCfFallback && cfBoughtTogetherProducts.length === 0
        ? relatedProducts.slice(0, PRODUCT_DISPLAY_CONFIG.BOUGHT_TOGETHER_LIMIT)
        : cfBoughtTogetherProducts;

    const reviewUserIds = [...new Set(reviewList.map((r) => String(r.userId)).filter(Boolean))];
    if (reviewUserIds.length > 0) {
      const users: IAccountUser[] = await AccountUser.find({ _id: { $in: reviewUserIds } }).select("_id fullName avatar");
      const userMap = new Map(users.map((u: IAccountUser) => [String(u._id), u]));
      for (const item of reviewList) {
        const u = item.userId ? userMap.get(String(item.userId)) : undefined;
        if (u) item.user = { fullName: u.fullName, avatar: u.avatar };
      }
    }

    formatProductItem(productDetail);
    for (const item of relatedProducts) formatProductItem(item);
    for (const item of boughtTogetherProducts) formatProductItem(item);

    cachedDetail = {
      productDetail,
      attributeList,
      relatedProducts,
      boughtTogetherProducts,
      reviewList
    };

    metadataCache.set(detailCacheKey, cachedDetail, 120);
  }

  if (!cachedDetail) return null;

  const { productDetail, attributeList, relatedProducts, boughtTogetherProducts, reviewList } = cachedDetail;

  const validHistory = (productViewHistory || [])
    .filter((id) => id && String(id) !== String(productDetail.id))
    .slice(0, PRODUCT_DISPLAY_CONFIG.VIEWED_PRODUCTS_LIMIT);

  const viewedProductsRaw = validHistory.length > 0
    ? await Product.find({
        _id: { $in: validHistory },
        deleted: false,
        status: "active"
      })
        .select("_id name slug images priceNew priceOld discount variants ratingAvg ratingCount")
        .limit(PRODUCT_DISPLAY_CONFIG.VIEWED_PRODUCTS_LIMIT)
    : [];

  const viewedProducts = [...viewedProductsRaw].sort(
    (a, b) => validHistory.indexOf(String(a._id)) - validHistory.indexOf(String(b._id))
  );
  for (const item of viewedProducts) formatProductItem(item);

  return {
    productDetail,
    attributeList,
    relatedProducts,
    boughtTogetherProducts,
    viewedProducts,
    reviewList
  };
};


export const reportReview = async (reviewId: string, userId: string) => {
  const review = await Review.findById(reviewId).select("_id productId");
  if (!review) {
    return { success: false, status: 404, message: "Review not found!" };
  }

  const result = await Review.updateOne(
    { _id: reviewId, reportedBy: { $ne: userId } },
    { $inc: { reportCount: 1 }, $push: { reportedBy: userId } }
  );
  if (result.modifiedCount === 0) {
    return { success: false, status: 409, message: "You have already reported this review!" };
  }

  if (review.productId) {
    const product = await Product.findById(review.productId).select("slug");
    if (product?.slug) {
      invalidateProductCaches(product.slug);
    }
  }

  return { success: true, message: "Review reported successfully!" };
};

export const getProductIdBySlug = async (slug: string): Promise<string | null> => {
  const product = await Product.findOne({ slug, deleted: false, status: "active" }).select("_id");
  return product ? String(product._id) : null;
};

export const getCategoryIdBySlug = async (slug: string): Promise<string | null> => {
  const category = await CategoryProduct.findOne({ slug, deleted: false, status: "active" }).select("_id");
  return category ? String(category._id) : null;
};

export const incrementProductView = async (productId: string) => {
  await Product.updateOne(
    { _id: productId, deleted: false, status: "active" },
    { $inc: { view: 1 } },
    // A view is not an edit: updatedAt feeds "last updated" dates, the sitemap and structured data.
    { timestamps: false }
  );
};

export const incrementCategoryProductView = async (categoryId: string) => {
  await CategoryProduct.updateOne(
    { _id: categoryId, deleted: false, status: "active" },
    { $inc: { view: 1 } },
    // A view is not an edit: updatedAt feeds "last updated" dates, the sitemap and structured data.
    { timestamps: false }
  );
};

// Upper bound of the storefront price filter: the most expensive active product, rounded up
// to a round number so the slider has sensible steps. Cleared with the other catalog caches.
export const getPriceFilterCeiling = async (): Promise<number> => {
  const cacheKey = "catalog:price_ceiling";
  const cached = metadataCache.get<number>(cacheKey);
  if (cached !== undefined) return cached;

  const top = await Product.findOne({ deleted: false, status: "active" }).sort({ priceNew: -1 }).select("priceNew");
  const highest = Math.max(0, top?.priceNew || 0);
  const magnitude = highest > 0 ? 10 ** Math.floor(Math.log10(highest)) : 1;
  const ceiling = highest > 0 ? Math.ceil(highest / magnitude) * magnitude : 0;

  metadataCache.set(cacheKey, ceiling, 600);
  return ceiling;
};

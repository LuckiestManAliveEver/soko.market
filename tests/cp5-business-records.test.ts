import { describe, expect, it } from "vitest";
import { buildApi } from "../services/api/src/app";
import { createCp2Store } from "../services/api/src/cp2/store";

interface OtpRequestResponse {
  challengeId: string;
  devOtp: string;
}

interface VerifyOtpResponse {
  session: {
    id: string;
  };
}

interface CreateBusinessResponse {
  business: {
    id: string;
  };
}

interface ProductResponse {
  id: string;
  businessId: string;
  name: string;
  sku: string | null;
  unit: string;
  quantity: number;
  buyingPrice: number | null;
  sellingPrice: number | null;
}

interface CustomerResponse {
  id: string;
  businessId: string;
  name: string;
  phone: string | null;
  email: string | null;
}

interface SupplierResponse {
  id: string;
  businessId: string;
  name: string;
  phone: string | null;
  email: string | null;
}

interface StockAdjustmentResponse {
  product: ProductResponse;
  movement: {
    productId: string;
    quantityBefore: number;
    quantityAfter: number;
    delta: number;
    reason: string;
  };
}

describe("CP5 business core records", () => {
  it("creates, edits, and lists products, customers, suppliers, and stock movements", async () => {
    const store = createCp2Store();
    const app = buildApi({ cp2: { store } });
    const { businessId, sessionCookie } = await createOwnerBusiness(app);

    const product = await postJson<ProductResponse>(
      app,
      `/businesses/${businessId}/products`,
      {
        name: " Maize   Flour ",
        sku: "MF-1",
        unit: "packet",
        quantity: 10,
        buyingPrice: 80,
        sellingPrice: 120
      },
      sessionCookie
    );

    expect(product).toMatchObject({
      businessId,
      name: "Maize Flour",
      sku: "MF-1",
      unit: "packet",
      quantity: 10,
      buyingPrice: 80,
      sellingPrice: 120
    });

    const updatedProduct = await patchJson<ProductResponse>(
      app,
      `/businesses/${businessId}/products/${product.id}`,
      {
        name: "Maize Flour 2kg",
        sku: "",
        unit: "bag",
        quantity: 8,
        buyingPrice: null,
        sellingPrice: 150
      },
      sessionCookie
    );

    expect(updatedProduct).toMatchObject({
      id: product.id,
      name: "Maize Flour 2kg",
      sku: null,
      unit: "bag",
      quantity: 8,
      buyingPrice: null,
      sellingPrice: 150
    });

    const stock = await postJson<StockAdjustmentResponse>(
      app,
      `/businesses/${businessId}/products/${product.id}/stock-adjustments`,
      {
        quantityAfter: 12,
        reason: "Counted shelf stock"
      },
      sessionCookie
    );

    expect(stock.product.quantity).toBe(12);
    expect(stock.movement).toMatchObject({
      productId: product.id,
      quantityBefore: 8,
      quantityAfter: 12,
      delta: 4,
      reason: "Counted shelf stock"
    });

    const customer = await postJson<CustomerResponse>(
      app,
      `/businesses/${businessId}/customers`,
      {
        name: " Amina   Otieno ",
        phone: "+254700000002",
        email: "AMINA@example.com"
      },
      sessionCookie
    );

    expect(customer).toMatchObject({
      businessId,
      name: "Amina Otieno",
      phone: "+254700000002",
      email: "amina@example.com"
    });

    const updatedCustomer = await patchJson<CustomerResponse>(
      app,
      `/businesses/${businessId}/customers/${customer.id}`,
      {
        name: "Amina Otieno",
        phone: "+254700000003",
        email: ""
      },
      sessionCookie
    );

    expect(updatedCustomer.email).toBeNull();
    expect(updatedCustomer.phone).toBe("+254700000003");

    const supplier = await postJson<SupplierResponse>(
      app,
      `/businesses/${businessId}/suppliers`,
      {
        name: "Wholesale Depot",
        phone: "+254700000004"
      },
      sessionCookie
    );

    expect(supplier).toMatchObject({
      businessId,
      name: "Wholesale Depot",
      phone: "+254700000004",
      email: null
    });

    const updatedSupplier = await patchJson<SupplierResponse>(
      app,
      `/businesses/${businessId}/suppliers/${supplier.id}`,
      {
        name: "Wholesale Depot Ltd",
        phone: "",
        email: "SUPPLY@example.com"
      },
      sessionCookie
    );

    expect(updatedSupplier).toMatchObject({
      id: supplier.id,
      name: "Wholesale Depot Ltd",
      phone: null,
      email: "supply@example.com"
    });

    const products = await getJson<ProductResponse[]>(
      app,
      `/businesses/${businessId}/products`,
      sessionCookie
    );
    const customers = await getJson<CustomerResponse[]>(
      app,
      `/businesses/${businessId}/customers`,
      sessionCookie
    );
    const suppliers = await getJson<SupplierResponse[]>(
      app,
      `/businesses/${businessId}/suppliers`,
      sessionCookie
    );

    expect(products).toHaveLength(1);
    expect(products[0]).toMatchObject({
      buyingPrice: null,
      sellingPrice: 150
    });
    expect(customers).toHaveLength(1);
    expect(suppliers).toHaveLength(1);
    expect(suppliers[0]).toMatchObject({
      id: supplier.id,
      name: "Wholesale Depot Ltd"
    });
    expect(store.snapshot().inventoryMovements).toHaveLength(3);
    expect(store.snapshot().auditEvents.map((event) => event.type)).toEqual(
      expect.arrayContaining([
        "product.created",
        "product.updated",
        "customer.created",
        "customer.updated",
        "supplier.created",
        "supplier.updated",
        "inventory.stock_adjusted"
      ])
    );

    const deletedProduct = await deleteJson<ProductResponse>(
      app,
      `/businesses/${businessId}/products/${product.id}`,
      sessionCookie
    );
    const productsAfterDelete = await getJson<ProductResponse[]>(
      app,
      `/businesses/${businessId}/products`,
      sessionCookie
    );

    expect(deletedProduct.id).toBe(product.id);
    expect(productsAfterDelete).toEqual([]);
    expect(store.snapshot().auditEvents.map((event) => event.type)).toContain("product.deleted");

    await app.close();
  });

  it("rejects invalid quantities and unauthenticated CP5 writes", async () => {
    const store = createCp2Store();
    const app = buildApi({ cp2: { store } });
    const { businessId, sessionCookie } = await createOwnerBusiness(app);

    const invalidProduct = await app.inject({
      method: "POST",
      url: `/businesses/${businessId}/products`,
      headers: {
        ...jsonHeaders(),
        cookie: sessionCookie
      },
      payload: JSON.stringify({
        name: "x",
        quantity: -1
      })
    });

    expect(invalidProduct.statusCode).toBe(400);
    expect(invalidProduct.json()).toMatchObject({
      code: "validation_failed"
    });

    const missingProductBody = await app.inject({
      method: "POST",
      url: `/businesses/${businessId}/products`,
      headers: {
        cookie: sessionCookie
      }
    });

    expect(missingProductBody.statusCode).toBe(400);
    expect(missingProductBody.json()).toMatchObject({
      code: "body_invalid"
    });

    const validProduct = await postJson<ProductResponse>(
      app,
      `/businesses/${businessId}/products`,
      {
        name: "Rice",
        quantity: 5
      },
      sessionCookie
    );

    const nullStockAdjustmentBody = await app.inject({
      method: "POST",
      url: `/businesses/${businessId}/products/${validProduct.id}/stock-adjustments`,
      headers: {
        ...jsonHeaders(),
        cookie: sessionCookie
      },
      payload: "null"
    });

    expect(nullStockAdjustmentBody.statusCode).toBe(400);
    expect(nullStockAdjustmentBody.json()).toMatchObject({
      code: "body_invalid"
    });

    const unauthenticatedProduct = await app.inject({
      method: "POST",
      url: `/businesses/${businessId}/products`,
      headers: jsonHeaders(),
      payload: JSON.stringify({
        name: "Blocked Product",
        quantity: 1
      })
    });

    expect(unauthenticatedProduct.statusCode).toBe(401);

    await app.close();
  });

  it("keeps configurable product fields explicit until the API is implemented", async () => {
    const store = createCp2Store();
    const app = buildApi({ cp2: { store } });
    const { businessId, sessionCookie } = await createOwnerBusiness(app);

    const response = await app.inject({
      method: "POST",
      url: `/businesses/${businessId}/products/fields`,
      headers: {
        ...jsonHeaders(),
        cookie: sessionCookie
      },
      payload: JSON.stringify({
        fields: [{ label: "Shelf", inputType: "text" }]
      })
    });

    expect(response.statusCode).toBe(501);
    expect(response.json()).toMatchObject({
      code: "product_fields_not_implemented"
    });

    await app.close();
  });

  it("keeps CP5 records scoped to their owning business", async () => {
    const store = createCp2Store();
    const app = buildApi({ cp2: { store } });
    const { businessId: firstBusinessId, sessionCookie } = await createOwnerBusiness(app);
    const secondBusiness = await postJson<CreateBusinessResponse>(
      app,
      "/businesses",
      {
        name: "Second Shop",
        language: "en"
      },
      sessionCookie
    );

    const product = await postJson<ProductResponse>(
      app,
      `/businesses/${firstBusinessId}/products`,
      {
        name: "Rice",
        quantity: 5
      },
      sessionCookie
    );

    const productsForSecondBusiness = await getJson<ProductResponse[]>(
      app,
      `/businesses/${secondBusiness.business.id}/products`,
      sessionCookie
    );

    expect(productsForSecondBusiness).toEqual([]);

    const crossBusinessStockAdjustment = await app.inject({
      method: "POST",
      url: `/businesses/${secondBusiness.business.id}/products/${product.id}/stock-adjustments`,
      headers: {
        ...jsonHeaders(),
        cookie: sessionCookie
      },
      payload: JSON.stringify({
        quantityAfter: 7
      })
    });

    expect(crossBusinessStockAdjustment.statusCode).toBe(404);
    expect(crossBusinessStockAdjustment.json()).toMatchObject({
      code: "product_not_found"
    });

    await app.close();
  });
});

async function createOwnerBusiness(app: ReturnType<typeof buildApi>) {
  const otpResponse = await postJson<OtpRequestResponse>(app, "/auth/otp/request", {
    channel: "phone",
    destination: "254700000005"
  });
  const verifyResponse = await app.inject({
    method: "POST",
    url: "/auth/otp/verify",
    headers: jsonHeaders(),
    payload: JSON.stringify({
      challengeId: otpResponse.challengeId,
      code: otpResponse.devOtp
    })
  });
  const sessionCookie = extractSessionCookie(verifyResponse.headers["set-cookie"]);
  const auth = verifyResponse.json<VerifyOtpResponse>();
  const business = await postJson<CreateBusinessResponse>(
    app,
    "/businesses",
    {
      name: "Jane's Shop",
      language: "en"
    },
    sessionCookie
  );

  expect(auth.session.id).toBeTruthy();

  return {
    businessId: business.business.id,
    sessionCookie
  };
}

async function postJson<TResponse>(
  app: ReturnType<typeof buildApi>,
  url: string,
  payload: Record<string, unknown>,
  cookie?: string
): Promise<TResponse> {
  const response = await app.inject({
    method: "POST",
    url,
    headers: cookie === undefined ? jsonHeaders() : { ...jsonHeaders(), cookie },
    payload: JSON.stringify(payload)
  });

  expect(response.statusCode).toBeGreaterThanOrEqual(200);
  expect(response.statusCode).toBeLessThan(300);

  return response.json<TResponse>();
}

async function patchJson<TResponse>(
  app: ReturnType<typeof buildApi>,
  url: string,
  payload: Record<string, unknown>,
  cookie: string
): Promise<TResponse> {
  const response = await app.inject({
    method: "PATCH",
    url,
    headers: {
      ...jsonHeaders(),
      cookie
    },
    payload: JSON.stringify(payload)
  });

  expect(response.statusCode).toBeGreaterThanOrEqual(200);
  expect(response.statusCode).toBeLessThan(300);

  return response.json<TResponse>();
}

async function deleteJson<TResponse>(
  app: ReturnType<typeof buildApi>,
  url: string,
  cookie: string
): Promise<TResponse> {
  const response = await app.inject({
    method: "DELETE",
    url,
    headers: {
      cookie
    }
  });

  expect(response.statusCode).toBeGreaterThanOrEqual(200);
  expect(response.statusCode).toBeLessThan(300);

  return response.json<TResponse>();
}

async function getJson<TResponse>(
  app: ReturnType<typeof buildApi>,
  url: string,
  cookie: string
): Promise<TResponse> {
  const response = await app.inject({
    method: "GET",
    url,
    headers: {
      cookie
    }
  });

  expect(response.statusCode).toBe(200);

  return response.json<TResponse>();
}

function jsonHeaders(): Record<string, string> {
  return {
    "content-type": "application/json"
  };
}

function extractSessionCookie(header: string | string[] | undefined): string {
  const value = Array.isArray(header) ? header[0] : header;

  if (value === undefined) {
    throw new Error("Expected set-cookie header.");
  }

  return value.split(";")[0] ?? value;
}

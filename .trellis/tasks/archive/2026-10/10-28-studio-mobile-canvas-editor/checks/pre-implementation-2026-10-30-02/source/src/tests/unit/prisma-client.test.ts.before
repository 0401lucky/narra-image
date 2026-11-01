import { createPrismaClient } from "../../../prisma/create-prisma-client";

describe("Prisma 客户端工厂", () => {
  it("传入连接串后可以构造 Prisma 7 客户端", async () => {
    const client = createPrismaClient({
      connectionString:
        "postgresql://postgres:postgres@localhost:5432/narra_image?schema=public",
    });

    expect(client).toBeTruthy();
    expect(typeof client.$disconnect).toBe("function");

    await client.$disconnect();
  });
});

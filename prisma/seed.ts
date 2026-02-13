import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  // Create the default user (single-user MVP)
  const user = await prisma.user.upsert({
    where: { id: 'default' },
    update: {},
    create: {
      id: 'default',
      name: 'Default User',
    },
  });

  console.log(`[Seed] Default user ready: ${user.id}`);
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });

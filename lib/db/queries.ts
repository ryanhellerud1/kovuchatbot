import { sql } from 'drizzle-orm';
import { and, asc, count, desc, eq, gt, gte, inArray, lt, type SQL } from 'drizzle-orm';

import { db } from './client';
import {
  user,
  chat,
  type User,
  document,
  type Suggestion,
  suggestion,
  message,
  vote,
  type DBMessage,
  type Chat,
  knowledgeDocuments,
  documentChunks,
  type KnowledgeDocument,
  type DocumentChunk,
} from './schema';
import type { ArtifactKind } from '@/components/artifact';
import { generateUUID } from '../utils';
import { generateHashedPassword } from './utils';

// Optionally, if not using email/pass login, you can
// use the Drizzle adapter for Auth.js / NextAuth
// https://authjs.dev/reference/adapter/drizzle



export async function getUser(email: string): Promise<Array<User>> {
  try {
    return await db.select().from(user).where(eq(user.email, email));
  } catch (error) {
    console.error('Failed to get user from database');
    throw error;
  }
}

export async function createUser(email: string, password: string) {
  const hashedPassword = generateHashedPassword(password);

  try {
    return await db.insert(user).values({ email, password: hashedPassword });
  } catch (error) {
    console.error('Failed to create user in database');
    throw error;
  }
}

export async function createGuestUser() {
  const email = `guest-${Date.now()}`;
  const password = generateHashedPassword(generateUUID());

  try {
    return await db.insert(user).values({ email, password }).returning({
      id: user.id,
      email: user.email,
    });
  } catch (error) {
    console.error('Failed to create guest user in database');
    throw error;
  }
}

export async function saveChat({
  id,
  userId,
  title,
}: {
  id: string;
  userId: string;
  title: string;
}) {
  try {
    return await db.insert(chat).values({
      id,
      createdAt: new Date(),
      userId,
      title,
    });
  } catch (error) {
    console.error('Failed to save chat in database');
    throw error;
  }
}

export async function deleteChatById({ id }: { id: string }) {
  try {
    await db.delete(vote).where(eq(vote.chatId, id));
    await db.delete(message).where(eq(message.chatId, id));

    const [chatsDeleted] = await db
      .delete(chat)
      .where(eq(chat.id, id))
      .returning();
    return chatsDeleted;
  } catch (error) {
    console.error('Failed to delete chat by id from database');
    throw error;
  }
}

export async function getChatsByUserId({
  id,
  limit,
  startingAfter,
  endingBefore,
}: {
  id: string;
  limit: number;
  startingAfter: string | null;
  endingBefore: string | null;
}) {
  try {
    const extendedLimit = limit + 1;

    const query = (whereCondition?: SQL<any>) =>
      db
        .select()
        .from(chat)
        .where(
          whereCondition
            ? and(whereCondition, eq(chat.userId, id))
            : eq(chat.userId, id),
        )
        .orderBy(desc(chat.createdAt))
        .limit(extendedLimit);

    let filteredChats: Array<Chat> = [];

    if (startingAfter) {
      const [selectedChat] = await db
        .select()
        .from(chat)
        .where(eq(chat.id, startingAfter))
        .limit(1);

      if (!selectedChat) {
        throw new Error(`Chat with id ${startingAfter} not found`);
      }

      filteredChats = await query(gt(chat.createdAt, selectedChat.createdAt));
    } else if (endingBefore) {
      const [selectedChat] = await db
        .select()
        .from(chat)
        .where(eq(chat.id, endingBefore))
        .limit(1);

      if (!selectedChat) {
        throw new Error(`Chat with id ${endingBefore} not found`);
      }

      filteredChats = await query(lt(chat.createdAt, selectedChat.createdAt));
    } else {
      filteredChats = await query();
    }

    const hasMore = filteredChats.length > limit;

    return {
      chats: hasMore ? filteredChats.slice(0, limit) : filteredChats,
      hasMore,
    };
  } catch (error) {
    console.error('Failed to get chats by user from database');
    throw error;
  }
}

export async function getChatById({ id }: { id: string }) {
  try {
    const [selectedChat] = await db.select().from(chat).where(eq(chat.id, id));
    return selectedChat;
  } catch (error) {
    console.error('Failed to get chat by id from database');
    throw error;
  }
}

export async function saveMessages({
  messages,
}: {
  messages: Array<DBMessage>;
}) {
  try {
    return await db.insert(message).values(messages);
  } catch (error) {
    console.error('Failed to save messages in database', error);
    throw error;
  }
}

export async function getMessagesByChatId({ id }: { id: string }) {
  try {
    return await db
      .select()
      .from(message)
      .where(eq(message.chatId, id))
      .orderBy(asc(message.createdAt));
  } catch (error) {
    console.error('Failed to get messages by chat id from database', error);
    throw error;
  }
}

export async function voteMessage({
  chatId,
  messageId,
  type,
}: {
  chatId: string;
  messageId: string;
  type: 'up' | 'down';
}) {
  try {
    const [existingVote] = await db
      .select()
      .from(vote)
      .where(and(eq(vote.messageId, messageId)));

    if (existingVote) {
      return await db
        .update(vote)
        .set({ isUpvoted: type === 'up' })
        .where(and(eq(vote.messageId, messageId), eq(vote.chatId, chatId)));
    }
    return await db.insert(vote).values({
      chatId,
      messageId,
      isUpvoted: type === 'up',
    });
  } catch (error) {
    console.error('Failed to upvote message in database', error);
    throw error;
  }
}

export async function getVotesByChatId({ id }: { id: string }) {
  try {
    return await db.select().from(vote).where(eq(vote.chatId, id));
  } catch (error) {
    console.error('Failed to get votes by chat id from database', error);
    throw error;
  }
}

export async function saveDocument({
  id,
  title,
  kind,
  content,
  userId,
}: {
  id: string;
  title: string;
  kind: ArtifactKind;
  content: string;
  userId: string;
}) {
  try {
    return await db
      .insert(document)
      .values({
        id,
        title,
        kind,
        content,
        userId,
        createdAt: new Date(),
      })
      .returning();
  } catch (error) {
    console.error('Failed to save document in database');
    throw error;
  }
}

export async function getDocumentsById({ id }: { id: string }) {
  try {
    const documents = await db
      .select()
      .from(document)
      .where(eq(document.id, id))
      .orderBy(asc(document.createdAt));

    return documents;
  } catch (error) {
    console.error('Failed to get document by id from database');
    throw error;
  }
}

export async function getDocumentById({ id }: { id: string }) {
  try {
    const [selectedDocument] = await db
      .select()
      .from(document)
      .where(eq(document.id, id))
      .orderBy(desc(document.createdAt));

    return selectedDocument;
  } catch (error) {
    console.error('Failed to get document by id from database');
    throw error;
  }
}

export async function deleteDocumentsByIdAfterTimestamp({
  id,
  timestamp,
}: {
  id: string;
  timestamp: Date;
}) {
  try {
    await db
      .delete(suggestion)
      .where(
        and(
          eq(suggestion.documentId, id),
          gt(suggestion.documentCreatedAt, timestamp),
        ),
      );

    return await db
      .delete(document)
      .where(and(eq(document.id, id), gt(document.createdAt, timestamp)))
      .returning();
  } catch (error) {
    console.error(
      'Failed to delete documents by id after timestamp from database',
    );
    throw error;
  }
}

export async function saveSuggestions({
  suggestions,
}: {
  suggestions: Array<Suggestion>;
}) {
  try {
    return await db.insert(suggestion).values(suggestions);
  } catch (error) {
    console.error('Failed to save suggestions in database');
    throw error;
  }
}

export async function getSuggestionsByDocumentId({
  documentId,
}: {
  documentId: string;
}) {
  try {
    return await db
      .select()
      .from(suggestion)
      .where(and(eq(suggestion.documentId, documentId)));
  } catch (error) {
    console.error(
      'Failed to get suggestions by document version from database',
    );
    throw error;
  }
}

export async function getMessageById({ id }: { id: string }) {
  try {
    return await db.select().from(message).where(eq(message.id, id));
  } catch (error) {
    console.error('Failed to get message by id from database');
    throw error;
  }
}

export async function deleteMessagesByChatIdAfterTimestamp({
  chatId,
  timestamp,
}: {
  chatId: string;
  timestamp: Date;
}) {
  try {
    const messagesToDelete = await db
      .select({ id: message.id })
      .from(message)
      .where(
        and(eq(message.chatId, chatId), gte(message.createdAt, timestamp)),
      );

    const messageIds = messagesToDelete.map((message) => message.id);

    if (messageIds.length > 0) {
      await db
        .delete(vote)
        .where(
          and(eq(vote.chatId, chatId), inArray(vote.messageId, messageIds)),
        );

      return await db
        .delete(message)
        .where(
          and(eq(message.chatId, chatId), inArray(message.id, messageIds)),
        );
    }
  } catch (error) {
    console.error(
      'Failed to delete messages by id after timestamp from database',
    );
    throw error;
  }
}

export async function updateChatVisiblityById({
  chatId,
  visibility,
}: {
  chatId: string;
  visibility: 'private' | 'public';
}) {
  try {
    return await db.update(chat).set({ visibility }).where(eq(chat.id, chatId));
  } catch (error) {
    console.error('Failed to update chat visibility in database');
    throw error;
  }
}

export async function getMessageCountByUserId({
  id,
  differenceInHours,
}: { id: string; differenceInHours: number }) {
  try {
    const twentyFourHoursAgo = new Date(
      Date.now() - differenceInHours * 60 * 60 * 1000,
    );

    const [stats] = await db
      .select({ count: count(message.id) })
      .from(message)
      .innerJoin(chat, eq(message.chatId, chat.id))
      .where(
        and(
          eq(chat.userId, id),
          gte(message.createdAt, twentyFourHoursAgo),
          eq(message.role, 'user'),
        ),
      )
      .execute();

    return stats?.count ?? 0;
  } catch (error) {
    console.error(
      'Failed to get message count by user id for the last 24 hours from database',
    );
    throw error;
  }
}

// Knowledge Base Document Operations

export async function saveKnowledgeDocument({
  id,
  userId,
  title,
  content,
  fileUrl,
  fileType,
  fileSize,
  metadata,
}: {
  id?: string;
  userId: string;
  title: string;
  content?: string;
  fileUrl?: string;
  fileType?: string;
  fileSize?: number;
  metadata?: any;
}): Promise<KnowledgeDocument> {
  try {
    const [knowledgeDocument] = await db
      .insert(knowledgeDocuments)
      .values({
        id,
        userId,
        title,
        content,
        fileUrl,
        fileType,
        fileSize,
        metadata,
      })
      .returning();

    return knowledgeDocument;
  } catch (error) {
    console.error('Failed to save knowledge document to database');
    throw error;
  }
}

export async function saveDocumentChunk({
  documentId,
  chunkIndex,
  content,
  embedding,
  metadata,
}: {
  documentId: string;
  chunkIndex: number;
  content: string;
  embedding: number[];
  metadata?: any;
}): Promise<DocumentChunk> {
  try {
    const [chunk] = await db
      .insert(documentChunks)
      .values({
        documentId,
        chunkIndex,
        content,
        embedding: embedding,
        chunkMetadata: metadata,
      })
      .returning();

    return chunk;
  } catch (error) {
    console.error('Failed to save document chunk to database');
    throw error;
  }
}

export async function getUserKnowledgeDocuments(
  userId: string,
  limit = 50,
  offset = 0,
): Promise<KnowledgeDocument[]> {
  try {
    return await db
      .select()
      .from(knowledgeDocuments)
      .where(eq(knowledgeDocuments.userId, userId))
      .orderBy(desc(knowledgeDocuments.createdAt))
      .limit(limit)
      .offset(offset);
  } catch (error) {
    console.error('Failed to get user knowledge documents from database');
    throw error;
  }
}

export async function getUserDocumentChunks(userId: string) {
  const maxRetries = 3;
  let lastError: Error;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`[getUserDocumentChunks] Attempt ${attempt}/${maxRetries} for user ${userId}`);
      
      const result = await db
        .select({
          id: documentChunks.id,
          documentId: documentChunks.documentId,
          content: documentChunks.content,
          embedding: documentChunks.embedding,
          chunkIndex: documentChunks.chunkIndex,
          chunkMetadata: documentChunks.chunkMetadata,
          documentTitle: knowledgeDocuments.title,
          createdAt: documentChunks.createdAt,
        })
        .from(documentChunks)
        .innerJoin(
          knowledgeDocuments,
          eq(documentChunks.documentId, knowledgeDocuments.id),
        )
        .where(eq(knowledgeDocuments.userId, userId))
        .orderBy(desc(documentChunks.createdAt));

      console.log(`[getUserDocumentChunks] Successfully retrieved ${result.length} chunks for user ${userId}`);
      return result;
    } catch (error) {
      lastError = error as Error;
      console.error(`[getUserDocumentChunks] Attempt ${attempt}/${maxRetries} failed:`, error);
      
      // Check if it's a connection error that might benefit from retry
      const isRetryableError = error instanceof Error && (
        error.message.includes('ECONNRESET') ||
        error.message.includes('ENOTFOUND') ||
        error.message.includes('ETIMEDOUT') ||
        error.message.includes('connection') ||
        error.code === 'ECONNRESET'
      );

      if (!isRetryableError || attempt === maxRetries) {
        console.error('Failed to get user document chunks from database');
        throw error;
      }

      // Wait before retrying (exponential backoff)
      const delay = Math.min(1000 * Math.pow(2, attempt - 1), 5000);
      console.log(`[getUserDocumentChunks] Retrying in ${delay}ms...`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  throw lastError!;
}

export async function getKnowledgeDocumentById(
  id: string,
  userId: string,
): Promise<KnowledgeDocument | null> {
  try {
    const [knowledgeDocument] = await db
      .select()
      .from(knowledgeDocuments)
      .where(
        and(eq(knowledgeDocuments.id, id), eq(knowledgeDocuments.userId, userId)),
      );

    return knowledgeDocument || null;
  } catch (error) {
    console.error('Failed to get knowledge document by id from database');
    throw error;
  }
}

export async function getDocumentChunks(documentId: string) {
  try {
    return await db
      .select()
      .from(documentChunks)
      .where(eq(documentChunks.documentId, documentId))
      .orderBy(asc(documentChunks.chunkIndex));
  } catch (error) {
    console.error('Failed to get document chunks from database');
    throw error;
  }
}

export async function getAdjacentChunksForDocuments(
  userId: string,
  chunks: Array<{ documentId: string; chunkIndex: number }>,
) {
  if (chunks.length === 0) {
    return [];
  }

  // Create an array of OR conditions for each chunk to get its neighbors
  const orConditions = chunks.map(chunk =>
    and(
      eq(knowledgeDocuments.userId, userId),
      eq(documentChunks.documentId, chunk.documentId),
      inArray(documentChunks.chunkIndex, [
        chunk.chunkIndex - 1,
        chunk.chunkIndex + 1,
      ]),
    ),
  );

  try {
    const result = await db
      .select({
        id: documentChunks.id,
        documentId: documentChunks.documentId,
        content: documentChunks.content,
        embedding: documentChunks.embedding,
        chunkIndex: documentChunks.chunkIndex,
        chunkMetadata: documentChunks.chunkMetadata,
        documentTitle: knowledgeDocuments.title,
        createdAt: documentChunks.createdAt,
      })
      .from(documentChunks)
      .innerJoin(
        knowledgeDocuments,
        eq(documentChunks.documentId, knowledgeDocuments.id),
      )
      .where(sql.join(orConditions, sql` OR `)); // Combine all conditions with OR

    return result;
  } catch (error) {
    console.error('Failed to get adjacent chunks from database', error);
    throw error;
  }
}

export async function similaritySearch({
  queryEmbedding,
  userId,
  k,
  minSimilarity = 0.1,
}: {
  queryEmbedding: number[];
  userId: string;
  k: number;
  minSimilarity?: number;
}) {
  try {
    // Use pgvector extension for similarity search with minimum threshold
    const vectorQuery = sql`
      SELECT
        dc.id,
        dc.document_id as "documentId",
        dc.content,
        dc.chunk_index as "chunkIndex",
        dc.chunk_metadata as "chunkMetadata",
        kd.title as "documentTitle",
        dc.created_at as "createdAt",
        1 - (dc.embedding <=> ${`[${queryEmbedding.join(',')}]`}) as similarity
      FROM document_chunks dc
      INNER JOIN knowledge_documents kd ON dc.document_id = kd.id
      WHERE kd.user_id = ${userId}
        AND dc.embedding IS NOT NULL
        AND (1 - (dc.embedding <=> ${`[${queryEmbedding.join(',')}]`})) >= ${minSimilarity}
      ORDER BY similarity DESC
      LIMIT ${Math.min(k, 50)}
    `;

    const results = await db.execute(vectorQuery);
    console.log(`[similaritySearch] Found ${results.length} results above similarity threshold ${minSimilarity}`);
    return results as unknown as DocumentChunk[];
  } catch (error) {
    console.error('Vector similarity search failed:', error);
    throw new Error('Vector similarity search is not available. Please ensure pgvector extension is installed.');
  }
}

export async function deleteKnowledgeDocument(
  id: string,
  userId: string,
): Promise<void> {
  try {
    // Delete chunks first (due to foreign key constraint)
    await db
      .delete(documentChunks)
      .where(eq(documentChunks.documentId, id));

    // Delete the document
    await db
      .delete(knowledgeDocuments)
      .where(
        and(eq(knowledgeDocuments.id, id), eq(knowledgeDocuments.userId, userId)),
      );
  } catch (error) {
    console.error('Failed to delete knowledge document from database');
    throw error;
  }
}

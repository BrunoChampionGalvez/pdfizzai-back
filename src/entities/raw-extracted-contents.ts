import { Column, Entity, ManyToOne, PrimaryGeneratedColumn } from "typeorm";
import { ChatMessage } from "./chat-message.entity";

@Entity('raw_extracted_contents')
export class RawExtractedContent {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('text')
  text: string;

  @ManyToOne(() => ChatMessage, (chatMessage) => chatMessage.rawExtractedContents)
  chatMessage: ChatMessage;

  @Column({ type: 'text', nullable: true })
  fileId: string; // ID of the file from which this content was extracted

  @Column({ type: 'text', nullable: true })
  fileName: string; // Name of the file from which this content was extracted

  @Column({ type: 'text', nullable: true })
  userId: string; // ID of the user who extracted this content

  @Column({ type: 'text', nullable: true})
  sessionId: string;

  @Column({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
  createdAt: Date;
}